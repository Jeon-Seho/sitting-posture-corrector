"""Validate private /dev exports and train a participant-isolated MediaPipe forecast LSTM.

Validation/preparation require only Python's standard library. PyTorch/NumPy are
loaded exclusively by train(); the repository gate also runs synthetic training.
"""
from __future__ import annotations

import argparse
import copy
import json
import platform
from pathlib import Path
import time

from model.analysis.mediapipe_data import (
    FEATURE_DEFINITION, POINT_DEFINITION, Prepared, SPLITS, create_pilot_manifest, prepare, private_path, require, sha256,
)


def fit_scaler(training_windows):
    """Train inputs only; held-out coordinates cannot influence normalization."""
    require(training_windows, 'Training windows are empty.')
    count = 0
    mean, m2 = [0.] * 39, [0.] * 39
    for window in training_windows:
        for row in window.inputs:
            count += 1
            for axis, value in enumerate(row):
                delta = value - mean[axis]
                mean[axis] += delta / count
                m2[axis] += delta * (value - mean[axis])
    return mean, [max((value / count) ** .5, .02) for value in m2]


def train(prepared: Prepared, output, epochs=25, seed=42, batch_size=64, threads=2):
    require(type(epochs) is int and 1 <= epochs <= 1000, 'epochs must be in 1..1000.')
    require(type(batch_size) is int and 1 <= batch_size <= 1024, 'batch-size must be in 1..1024.')
    require(type(threads) is int and 1 <= threads <= 16, 'threads must be in 1..16.')
    require(type(seed) is int and 0 <= seed < 2 ** 32, 'seed must be an unsigned 32-bit integer.')
    output = private_path(output)
    require(not output.exists() or (output.is_dir() and not any(output.iterdir())), 'Choose a new or empty output directory; completed models are never overwritten.')
    try:
        import numpy as np
        import torch
        from torch import nn
    except ImportError as error:
        raise ValueError('Training requires the optional environment: pip install -r model/analysis/requirements-lstm.txt') from error

    class Forecast(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(39, 48, batch_first=True)
            self.output = nn.Linear(48, 39)

        def forward(self, inputs):
            hidden, _ = self.lstm(inputs)
            return inputs[:, -1] + 3 * (inputs[:, -1] - inputs[:, -2]) + self.output(hidden[:, -1])

    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.set_num_threads(threads)
    mean_list, scale_list = fit_scaler(prepared.windows['train'])
    mean, scale = np.asarray(mean_list, dtype=np.float32), np.asarray(scale_list, dtype=np.float32)
    arrays = {}
    for split, windows in prepared.windows.items():
        if windows:
            inputs = np.asarray([window.inputs for window in windows], dtype=np.float32)
            targets = np.asarray([window.target for window in windows], dtype=np.float32)
            require(np.isfinite(inputs).all() and np.isfinite(targets).all(), 'Non-finite model input.')
            arrays[split] = (inputs, targets, torch.from_numpy((inputs - mean) / scale), torch.from_numpy((targets - mean) / scale))
    model = Forecast()
    optimizer = torch.optim.Adam(model.parameters(), lr=.001)
    history, best, best_epoch, best_loss = [], None, 0, float('inf')
    started = time.perf_counter()
    tx, ty = arrays['train'][2:]
    for epoch in range(epochs):
        model.train()
        total = 0.
        for indices in torch.randperm(len(tx)).split(batch_size):
            optimizer.zero_grad()
            loss = nn.functional.mse_loss(model(tx[indices]), ty[indices])
            require(torch.isfinite(loss).item(), 'Training produced a non-finite loss; no model was exported.')
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            optimizer.step()
            total += loss.item() * len(indices)
        entry = {'epoch': epoch + 1, 'training_mse': total / len(tx)}
        model.eval()
        # The test partition is never forwarded during training/model selection.
        if prepared.mode != 'pilot':
            vx, vy = arrays['validation'][2:]
            with torch.no_grad():
                validation_loss = sum(nn.functional.mse_loss(model(batch), vy[start:start + len(batch)], reduction='sum').item()
                                      for start, batch in ((start, vx[start:start + batch_size]) for start in range(0, len(vx), batch_size))) / vy.numel()
            entry['validation_mse'] = validation_loss
            if validation_loss < best_loss:
                best_loss, best_epoch, best = validation_loss, epoch + 1, copy.deepcopy(model.state_dict())
        history.append(entry)
        print(json.dumps(entry), flush=True)
    if best is not None:
        model.load_state_dict(best)
    else:
        best_epoch = epochs
    model.eval()

    def metrics(prediction, target):
        difference = prediction - target
        point_error = np.linalg.norm(difference.reshape(-1, 13, 3), axis=2)
        balanced = (point_error[:, :9].mean(axis=1) + point_error[:, 9:11].mean(axis=1) + point_error[:, 11:].mean(axis=1)) / 3
        return {'coordinate_mae_shoulder_units': float(np.abs(difference).mean()),
                'balanced_point_distance_shoulder_units': float(balanced.mean())}

    def evaluate(name):
        inputs, targets, normalized, _ = arrays[name]
        with torch.no_grad():
            predictions = torch.cat([model(batch) for batch in normalized.split(batch_size)]).numpy() * scale + mean
        require(np.isfinite(predictions).all(), 'Evaluation produced non-finite predictions; no model was exported.')
        horizons = np.asarray([(window.target_ms - window.input_end_ms) / 100 for window in prepared.windows[name]], dtype=np.float32)[:, None]
        return {'lstm': metrics(predictions, targets), 'hold_last': metrics(inputs[:, -1], targets),
                'constant_velocity': metrics(inputs[:, -1] + horizons * (inputs[:, -1] - inputs[:, -2]), targets)}

    evaluations = {split: evaluate(split) if split in arrays else None for split in SPLITS}
    training_metadata = copy.deepcopy(prepared.report['training'])
    training_metadata['participant_generalization_evaluated'] = prepared.mode != 'pilot'
    config = {'steps': 30, 'dimensions': 39, 'hidden': 48, 'horizon': 3, 'point_definition': POINT_DEFINITION}
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = output / 'research-lstm.pt'
    torch.save({'state_dict': model.state_dict(), 'mean': torch.from_numpy(mean), 'scale': torch.from_numpy(scale),
                'config': config, 'pose_model_id': prepared.pose_model_id, 'feature_definition': FEATURE_DEFINITION}, checkpoint)
    digest = sha256(checkpoint)
    model_prefix = 'explicit-synthetic-mediapipe-lstm' if prepared.report['explicit_synthetic'] else 'mediapipe-lstm'
    export = {'schema_version': 'forecast-weights-v2', 'model_id': f'{model_prefix}-{digest[:12]}',
              'source_sha256': digest, 'domain_validated': False, 'data_domain': 'mediapipe',
              'pose_model_id': prepared.pose_model_id, 'feature_definition': FEATURE_DEFINITION,
              'config': config, 'mean': mean.tolist(), 'scale': scale.tolist(),
              'weights': {key: value.flatten().tolist() for key, value in model.state_dict().items()},
              'training': training_metadata}
    (output / 'model.json').write_text(json.dumps(export, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    # Fixed, explicitly synthetic parity input: never copy any participant window into this artifact.
    parity = np.sin(np.arange(30 * 39, dtype=np.float32).reshape(30, 39) * .01) * .1
    with torch.no_grad():
        expected = model(torch.from_numpy((parity - mean) / scale)[None])[0].numpy() * scale + mean
    (output / 'explicit-synthetic-parity.json').write_text(json.dumps({'explicit_synthetic': True, 'input': parity.tolist(), 'expected': expected.tolist()}, allow_nan=False), encoding='utf-8')
    report = copy.deepcopy(prepared.report)
    report['training'] = training_metadata
    report.update({'epochs': epochs, 'selected_epoch': best_epoch, 'selection': 'last_epoch_no_evaluation' if prepared.mode == 'pilot' else 'lowest_validation_mse',
                   'seed': seed, 'batch_size': batch_size, 'history': history,
                   'normalization': {'fitted_on': 'training_input_windows_only', 'minimum_scale': .02},
                   'forecast_metrics': evaluations, 'training_seconds': time.perf_counter() - started,
                   'checkpoint_sha256': digest, 'model_sha256': sha256(output / 'model.json'),
                   'environment': {'python': platform.python_version(), 'torch': torch.__version__, 'device': 'cpu', 'threads': threads},
                   'browser_model_installed': False})
    (output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('manifest', 'validate', 'prepare', 'train'))
    parser.add_argument('collections', type=Path, nargs='*', help='Explicit input files for single-participant pilot manifest creation.')
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--mode', choices=('participant_holdout', 'pilot'), default='participant_holdout')
    parser.add_argument('--maximum-windows', type=int, default=20_000)
    parser.add_argument('--output', type=Path, help='New manifest file or private training directory; never a frontend asset path.')
    parser.add_argument('--epochs', type=int, default=25)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_intermixed_args(argv)
    try:
        if args.command == 'manifest':
            require(args.mode == 'pilot' and args.manifest is None and args.output is not None,
                    'manifest requires --mode pilot --output NEW_FILE and explicit collection paths; holdout splits must be assigned manually.')
            print(json.dumps(create_pilot_manifest(args.collections, args.output), indent=2))
            return
        require(args.manifest is not None and not args.collections, 'validate/prepare/train require --manifest and no positional collection paths.')
        prepared = prepare(args.manifest, args.mode, args.maximum_windows)
        if args.command == 'train':
            require(args.output is not None, 'train requires --output pointing to a new private directory.')
            report = train(prepared, args.output, args.epochs, args.seed, args.batch_size, args.threads)
        else:
            require(args.output is None, 'validate/prepare are dry-run commands; omit --output.')
            report = prepared.report
        print(json.dumps(report, indent=2, allow_nan=False))
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(2, f'MediaPipe preparation/training refused: {error}\n')


if __name__ == '__main__':
    main()
