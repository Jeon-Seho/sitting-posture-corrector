"""Train-only Panoptic forecast feasibility study; not a posture classifier."""
import argparse
import hashlib
import json
import platform
import re
import tarfile
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
FACE = [30, 36, 37, 39, 42, 43, 45, 48, 54]
BODY = [16, 18, 3, 9]  # ears, shoulders; Panoptic order, not MediaPipe
HASHES = {
    'hdPose3d_stage1_coco19.tar': '290333b2f2c770b26d49175ac3f05434b7e53380f6c274db68f5919732c3e1e0',
    'hdFace3d.tar': '04cead2585d58c37c91855db5c201135a903357d9967d079561923968c1b5afd',
}


def private_path(path):
    path = Path(path).resolve()
    if not any(path.is_relative_to(ROOT / name) for name in ('data', 'runs')):
        raise ValueError('Real input/output must be under ignored data/ or runs/')
    return path


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def records(path):
    with tarfile.open(path) as tar:
        members = sorted((m for m in tar if m.isfile() and m.name.endswith('.json')),
                         key=lambda m: m.name)
        for m in members:
            index = int(re.search(r'(\d+)\.json$', m.name).group(1))
            yield index, json.load(tar.extractfile(m))


def frame_features(body, face, threshold=0.15):
    """Reject low-quality observations; never fill missing points as normal."""
    b = np.asarray(body['joints19'], dtype=float).reshape(19, 4)
    f = np.asarray(face['landmarks'], dtype=float).reshape(70, 3)
    score = np.asarray(face['averageScore'], dtype=float)[FACE]
    error = np.asarray(face['averageReproError'], dtype=float)[FACE]
    if (not np.isfinite(b[BODY]).all() or not np.isfinite(f[FACE]).all()
            or not np.isfinite(score).all() or not np.isfinite(error).all()
            or (b[BODY, 3] < threshold).any() or (score < threshold).any()
            or (error > 5).any() or (error < 0).any()
            or any(len(face['visibility'][i]) < 2 for i in FACE)):
        return None
    center = (b[3, :3] + b[9, :3]) / 2
    span = np.linalg.norm(b[3, :3] - b[9, :3])
    if not np.isfinite(span) or span < 1:
        return None
    p = np.concatenate([f[FACE], b[BODY, :3]])
    return ((p - center) / span).astype(np.float32).ravel()


def load_tracks(folder, threshold):
    faces = {}
    for index, frame in records(folder / 'hdFace3d.tar'):
        faces[index] = {p['id']: p['face70'] for p in frame['people'] if p['id'] >= 0}
    tracks = defaultdict(list)
    stats = Counter()
    for index, frame in records(folder / 'hdPose3d_stage1_coco19.tar'):
        for body in frame['bodies']:
            stats['body_records'] += 1
            face = faces.get(index, {}).get(body['id'])
            if face is None:
                stats['unmatched_face'] += 1
                continue
            value = frame_features(body, face, threshold)
            if value is None:
                stats['unmeasurable'] += 1
                continue
            tracks[body['id']].append((index, frame['univTime'], value))
            stats['measurable'] += 1
    return dict(tracks), dict(stats)


def windows(tracks, steps=30, downsample=3, horizon=3, stride=3):
    if min(steps, downsample, horizon, stride) < 1:
        raise ValueError('Window settings must be positive')
    x, y, owners = [], [], []
    for owner, rows in sorted(tracks.items()):
        rows = sorted(rows, key=lambda row: row[0])
        if any(b[1] <= a[1] for a, b in zip(rows, rows[1:])):
            raise ValueError('Time reversed or duplicated')
        segments = []
        start = 0
        for i in range(1, len(rows)):
            if rows[i][0] != rows[i-1][0] + 1 or not 25 <= rows[i][1]-rows[i-1][1] <= 45:
                segments.append(rows[start:i]); start = i
        segments.append(rows[start:])
        for segment in segments:
            segment = segment[::downsample]
            for end in range(steps, len(segment)-horizon+1, stride):
                x.append([r[2] for r in segment[end-steps:end]])
                y.append(segment[end+horizon-1][2]); owners.append(owner)
    if not x:
        raise ValueError('No continuous quality-valid windows')
    return np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32), owners


class Forecast(nn.Module):
    def __init__(self, dimensions=39, hidden=48):
        super().__init__()
        self.lstm = nn.LSTM(dimensions, hidden, batch_first=True)
        self.output = nn.Linear(hidden, dimensions)

    def forward(self, x):
        # Residual from constant-velocity forecast; LSTM learns its correction.
        h, _ = self.lstm(x)
        return x[:, -1] + 3 * (x[:, -1] - x[:, -2]) + self.output(h[:, -1])


def metrics(prediction, target):
    difference = prediction - target
    return {'coordinate_mae_shoulder_units': float(np.abs(difference).mean()),
            'point_distance_shoulder_units': float(np.linalg.norm(difference.reshape(-1, 13, 3), axis=2).mean())}


def fit(x, y, output, epochs=25, seed=42):
    if epochs < 1 or x.ndim != 3 or x.shape[1] < 2 or x.shape[2] != 39 or y.shape != (len(x), 39):
        raise ValueError('Invalid train shapes/settings')
    if not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError('Non-finite input')
    torch.manual_seed(seed); np.random.seed(seed); torch.set_num_threads(4)
    mean = x.reshape(-1, 39).mean(axis=0)
    scale = np.maximum(x.reshape(-1, 39).std(axis=0), 0.02)
    tx = torch.from_numpy((x-mean)/scale); ty = torch.from_numpy((y-mean)/scale)
    model = Forecast(); optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    history = []; start = time.perf_counter()
    for epoch in range(epochs):
        model.train(); total = 0.
        for ix in torch.randperm(len(tx)).split(128):
            optimizer.zero_grad(); loss = nn.functional.mse_loss(model(tx[ix]), ty[ix])
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            total += loss.item()*len(ix)
        history.append(total/len(tx))
        print(json.dumps({'epoch': epoch+1, 'training_mse': history[-1]}), flush=True)
    model.eval()
    with torch.no_grad():
        pred = torch.cat([model(batch) for batch in tx.split(256)]).numpy()*scale+mean
    report = {'task': 'forecast_0.3_seconds', 'evaluation_scope': 'training_fit_only',
              'participant_generalization_evaluated': False, 'test_metrics': None,
              'posture_accuracy': None, 'personal_baseline_used': False,
              'windows': len(x), 'history': history, 'epochs': epochs, 'seed': seed,
              'training_seconds': time.perf_counter()-start,
              'parameters': sum(p.numel() for p in model.parameters()),
              'training_diagnostics': {'lstm': metrics(pred, y),
                                      'hold_last': metrics(x[:, -1], y),
                                      'constant_velocity': metrics(x[:, -1]+3*(x[:, -1]-x[:, -2]), y)},
              'environment': {'python': platform.python_version(), 'torch': torch.__version__,
                              'device': 'cpu', 'platform': platform.platform()}}
    output.mkdir(parents=True, exist_ok=True)
    bundle = {'state_dict': model.state_dict(), 'mean': torch.from_numpy(mean),
                'scale': torch.from_numpy(scale), 'config': {'steps': 30, 'dimensions': 39,
                'hidden': 48, 'horizon': 3, 'point_definition': 'Panoptic-face9-body4-not-MediaPipe'}}
    # Use Python's path handling for Windows Unicode/sandbox paths.
    with (output/'research-lstm.pt').open('wb') as stream:
        torch.save(bundle, stream)
    (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--epochs', type=int, default=25)
    parser.add_argument('--synthetic-smoke', action='store_true')
    args = parser.parse_args(); output = private_path(args.output)
    if (output/'report.json').exists():
        raise ValueError('Choose a new run directory; do not overwrite a completed run')
    if args.synthetic_smoke:
        t = np.arange(180, dtype=np.float32)
        rows = [(int(i), float(i*1000/29.97), np.sin(i*.02+np.arange(39)*.1).astype(np.float32)) for i in t]
        x, y, owners = windows({0: rows}); metadata = {'explicit_synthetic': True}
    else:
        if args.data is None:
            parser.error('--data required unless --synthetic-smoke')
        data = private_path(args.data); hashes = {name: sha256(data/name) for name in HASHES}
        if hashes != HASHES:
            raise ValueError('Unreviewed dataset hashes')
        tracks, stats = load_tracks(data, 0.15)
        x, y, owners = windows(tracks)
        metadata = {'explicit_synthetic': False, 'source_hashes': hashes, 'quality_counts': stats,
                    'point_order': {'face70': FACE, 'joints19': BODY},
                    'experimental_quality': {'minimum_score': 0.15, 'max_reprojection_error': 5,
                    'minimum_face_camera_views': 2}, 'sample_interval_seconds': 3/29.97,
                    'track_window_counts': dict(Counter(owners)),
                    'partition': 'entire source sequence assigned to training; no validation/test',
                    'participant_mapping_verified': False}
        print(json.dumps(metadata), flush=True)
    report = fit(x, y, output, args.epochs); report.update(metadata)
    (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report['training_diagnostics']), flush=True)


if __name__ == '__main__':
    main()
