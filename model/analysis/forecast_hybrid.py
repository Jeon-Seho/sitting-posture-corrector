"""Synthetic-only causal forecast/rule experiment, separate from service CEP."""
import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch

from model.analysis.panoptic_lstm import Forecast, private_path, sha256


def distance(a, b):
    """Equal weight for face, ears and shoulders, in shoulder-width units."""
    d = np.linalg.norm((np.asarray(a)-np.asarray(b)).reshape(-1, 13, 3), axis=2)
    return (d[:, :9].mean(1)+d[:, 9:11].mean(1)+d[:, 11:].mean(1))/3


@dataclass(frozen=True)
class Settings:
    far: float = .12
    near: float = .08
    sustained_seconds: float = 3.
    predictable_seconds: float = 1.
    fallback_seconds: float = 5.
    recovery_seconds: float = 3.
    max_gap: float = .15


class Policy:
    """High residual is a motion candidate, never proof of temporary behavior."""
    def __init__(self, settings=Settings(), rule_only=False):
        if not 0 <= settings.near < settings.far or settings.fallback_seconds < settings.sustained_seconds:
            raise ValueError('Invalid policy settings')
        self.settings = settings; self.rule_only = rule_only
        self.last = None; self.far_since = None; self.predictable_since = None
        self.near_since = None; self.persistent = False; self.events = []

    def reset(self):
        self.far_since = None; self.predictable_since = None
        self.near_since = None; self.persistent = False

    def step(self, now, deviation, error, error_limit, measurable=True):
        if not np.isfinite(now) or (self.last is not None and now <= self.last):
            raise ValueError('Time must strictly increase')
        gap = self.last is not None and now-self.last > self.settings.max_gap
        self.last = now
        if gap:
            self.reset()
        if not measurable or not np.isfinite(deviation):
            self.reset(); return 'unmeasurable'
        s = self.settings
        outside = deviation >= s.far or (self.far_since is not None and deviation > s.near)
        if outside:
            self.near_since = None
            if self.far_since is None:
                self.far_since = now
            predictable = error is not None and np.isfinite(error) and error <= error_limit
            if predictable:
                if self.predictable_since is None:
                    self.predictable_since = now
            else:
                self.predictable_since = None
            age = now-self.far_since
            stable = self.predictable_since is not None and now-self.predictable_since >= s.predictable_seconds-1e-8
            should_confirm = age >= s.sustained_seconds-1e-8 and (self.rule_only or stable)
            fallback = age >= s.fallback_seconds-1e-8
            if should_confirm or fallback:
                if not self.persistent:
                    self.events.append({'kind': 'persistent_deviation_candidate', 'at': now,
                                        'onset': self.far_since, 'fallback': fallback and not should_confirm})
                self.persistent = True
            if self.persistent:
                return 'persistent_deviation_candidate'
            if self.rule_only:
                return 'deviation_pending'
            return 'unexpected_motion_candidate' if error is not None and not predictable else 'deviation_pending'
        # Within near threshold: return proves this completed excursion was temporary.
        if self.far_since is not None and not self.persistent:
            self.events.append({'kind': 'returned_excursion', 'at': now, 'onset': self.far_since})
        self.far_since = None; self.predictable_since = None
        if self.persistent:
            if self.near_since is None:
                self.near_since = now
            if now-self.near_since < s.recovery_seconds-1e-8:
                return 'recovery_pending'
            self.events.append({'kind': 'recovered', 'at': now})
            self.persistent = False
        self.near_since = None
        return 'near_reference'


def scenarios(seed=17):
    """Hand-built Panoptic-shaped geometry; no real participant landmarks."""
    rng = np.random.default_rng(seed); t = np.arange(300)/10
    pose = np.array([[0,-.65,-.08],[-.16,-.75,0],[-.13,-.77,0],[-.08,-.75,0],
                     [.08,-.75,0],[.13,-.77,0],[.16,-.75,0],[-.08,-.52,-.06],
                     [.08,-.52,-.06],[-.27,-.68,.03],[.27,-.68,.03],[-.5,0,0],[.5,0,0]], dtype=np.float32)
    noise = rng.normal(0,.002,(len(t),13,3)).astype(np.float32)
    base = pose[None]+noise
    abrupt = ((t>=10)&(t<11)).astype(float)
    gradual = np.clip((t-10)/8,0,1)
    smooth_return = np.where((t>=10)&(t<=12),np.sin(np.pi*(t-10)/2),0)
    repeated = np.where(t>=10, .5+.5*np.sin((t-10)*np.pi), 0)
    plans = [('reference_hold',np.zeros(len(t)),False),('abrupt_return',abrupt,False),
             ('gradual_hold',gradual,True),('abrupt_hold',(t>=10).astype(float),True),
             ('smooth_return',smooth_return,False),('repeated_motion',repeated,False),
             ('long_return',((t>=10)&(t<17)).astype(float),False),
             ('unpredictable_hold',(t>=10).astype(float),True),
             ('poor_quality_hold',(t>=10).astype(float),True),
             ('gap_during_hold',(t>=10).astype(float),True)]
    out = []
    for name, amount, expected in plans:
        p = base.copy(); p[:, :11, 1] += (amount*.4).astype(np.float32)[:, None]
        p[:, :11, 2] -= (amount*.25).astype(np.float32)[:, None]
        if name == 'unpredictable_hold':
            # Sustained far posture with rapid oscillation: prediction error must not veto it forever.
            oscillation = np.where(t>=10,np.where(np.arange(len(t))%2,.14,-.14),0)
            p[:, :11, 0] += oscillation.astype(np.float32)[:, None]
        quality = np.ones(len(t),dtype=bool)
        if name == 'poor_quality_hold': quality[(t>=12)&(t<18)] = False
        times = t.copy()
        if name == 'gap_during_hold': times[t>=12] += 2
        out.append({'name':name,'time':times,'values':p.reshape(-1,39), 'quality':quality,
                    'expected_persistent': expected})
    return out


def causal_forecasts(values, times, quality, bundle, model):
    n = len(values); residuals = {k: np.full(n,np.nan) for k in ('lstm','hold_last','constant_velocity')}
    inputs = []; targets = []
    for target in range(32,n):
        start = target-32; end = target-3
        if not quality[start:target+1].all() or not (np.diff(times[start:target+1]) <= .15).all():
            continue
        inputs.append(values[start:end+1]); targets.append(target)
    if not inputs:
        return residuals
    x = np.asarray(inputs); ix = np.asarray(targets)
    mean = bundle['mean'].numpy(); scale = bundle['scale'].numpy()
    with torch.no_grad():
        pred = model(torch.from_numpy((x-mean)/scale)).numpy()*scale+mean
    residuals['lstm'][ix] = distance(pred, values[ix])
    residuals['hold_last'][ix] = distance(x[:, -1], values[ix])
    residuals['constant_velocity'][ix] = distance(x[:, -1]+3*(x[:, -1]-x[:, -2]), values[ix])
    return residuals


def run(bundle_path, output):
    output = private_path(output); bundle_path = private_path(bundle_path)
    if (output/'report.json').exists():
        raise ValueError('Choose a new experiment output')
    torch.set_num_threads(4)
    bundle = torch.load(bundle_path, map_location='cpu', weights_only=True)
    expected = {'steps':30,'dimensions':39,'hidden':48,'horizon':3,
                'point_definition':'Panoptic-face9-body4-not-MediaPipe'}
    if bundle['config'] != expected:
        raise ValueError('Unsupported checkpoint point/time definition')
    model = Forecast(); model.load_state_dict(bundle['state_dict']); model.eval()
    cases = scenarios(); settings = Settings()
    # Freeze thresholds on the separate reference-hold calibration segment only.
    calibration = cases[0]; reference = np.median(calibration['values'][:80],axis=0)
    calibrated = causal_forecasts(calibration['values'],calibration['time'],calibration['quality'],bundle,model)
    limits = {k:max(.02,float(np.nanquantile(v[32:80],.99))) for k,v in calibrated.items()}
    report = {'scope':'explicit_synthetic_behavior_experiment', 'participant_accuracy':None,
              'model_sha256':sha256(bundle_path), 'settings':asdict(settings),'residual_limits':limits,
              'calibration':'reference-hold first 8 seconds only; frozen before scenarios',
              'model_training':'Panoptic v1 train-only checkpoint; not validated on service data', 'cases':[]}
    traces = {}
    for case in cases:
        errors = causal_forecasts(case['values'],case['time'],case['quality'],bundle,model)
        deviations = distance(case['values'], reference)
        policies = {k:Policy(settings) for k in errors}; policies['rule_only'] = Policy(settings,rule_only=True)
        policies['lstm_error_gate_only'] = Policy(Settings(fallback_seconds=1e9))
        states = {k:[] for k in policies}
        for i,t in enumerate(case['time']):
            for key, policy in policies.items():
                predictor = 'lstm' if key=='lstm_error_gate_only' else key
                error = None if key=='rule_only' or not np.isfinite(errors[predictor][i]) else float(errors[predictor][i])
                states[key].append(policy.step(float(t),float(deviations[i]),error,
                                  limits.get(predictor,np.inf),bool(case['quality'][i])))
        results = {}
        for key,policy in policies.items():
            events = [e for e in policy.events if e['kind']=='persistent_deviation_candidate']
            vals = errors.get('lstm' if key=='lstm_error_gate_only' else key,np.array([])); finite = vals[np.isfinite(vals)]
            results[key] = {'persistent_events':events,'returned_excursions':sum(e['kind']=='returned_excursion' for e in policy.events),
                            'unexpected_motion_samples':states[key].count('unexpected_motion_candidate'),
                            'unmeasurable_samples':states[key].count('unmeasurable'),
                            'mean_residual':float(finite.mean()) if len(finite) else None}
        report['cases'].append({'name':case['name'],'synthetic_intent_persistent':case['expected_persistent'],
                                'results':results})
        traces[case['name']] = {'time':case['time'].tolist(),'deviation':deviations.tolist(),
                               'quality':case['quality'].tolist(),'states':states,
                               'residuals':{k:[float(v) if np.isfinite(v) else None for v in a] for k,a in errors.items()}}
    output.mkdir(parents=True,exist_ok=True)
    (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    (output/'explicit-synthetic-traces.json').write_text(json.dumps(traces),encoding='utf-8')
    print(json.dumps(report,indent=2))
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a = p.parse_args();run(a.model,a.output)


if __name__=='__main__':
    main()
