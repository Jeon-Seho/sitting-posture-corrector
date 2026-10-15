"""Explicit synthetic exports for end-to-end preparation/training validation only."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from model.analysis.mediapipe_data import COLLECTION_FEATURE, distance, normalized_values, prepare, private_path, sha256
from model.analysis.mediapipe_lstm import train

SYNTHETIC_MODEL_ID = 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1'


def synthetic_frame(index, model=SYNTHETIC_MODEL_ID, interval=100, phase=0.):
    image = [{'x': .3 if i == 11 else .7 if i == 12 else .5, 'y': .3 if i < 11 else .6,
              'z': 0., 'visibility': .99} for i in range(13)]
    world = [dict(point) for point in image]
    for point in world[:11]:
        point['x'] += math.sin(index * .07 + phase) * .001
    return {'timeMs': index * interval, 'videoTimeMs': index * interval, 'segment': 0, 'poseModelId': model,
            'width': 640, 'height': 480, 'image': image, 'world': world, 'values': normalized_values(image, world)}


def synthetic_collection(participant='synthetic_train', count=60, version=2, threshold=.03, phase=0.):
    model = SYNTHETIC_MODEL_ID
    collection_id, run, reference = f'collection_{participant}', f'run_{participant}', f'ref_{participant}'
    baseline = synthetic_frame(0, model, phase=phase)['values']
    labels = {'label': 'normal_auto_assumed', 'labelSource': 'auto_rule', 'review': 'not_reviewed', 'displayLabel': '정상자세(자동)'}
    rows = []
    for i in range(count):
        row = synthetic_frame(i, model, phase=phase)
        row.update({'row': i + 1, 'observationTimeMs': i * 100, 'runId': run, 'referenceId': reference,
                    'participantCode': participant, 'deviation': distance(row['values'], baseline), **labels})
        if version == 2:
            row['maximumDeviation'] = threshold
        rows.append(row)
    selection = {'metric': 'balanced_face_ears_shoulders_distance', 'inclusive': True, 'maximumHz': 10, 'interpolation': False}
    selection.update({'thresholdSource': 'row.maximumDeviation', 'configuredMaximumDeviation': threshold,
                      'allowedMaximumDeviations': [.005, .03, .06]} if version == 2 else {'maximumDeviation': .005})
    return {'schema_version': f'normal-posture-auto-collection-v{version}', 'id': collection_id, 'explicitSynthetic': True,
            'source': 'webcam', 'createdAt': '2026-10-14T00:00:00Z', **labels,
            'purpose': 'early_experiment_only', 'domainValidated': False, 'selection': selection,
            'timing': {'unit': 'ms', 'timeMs': 'camera_observation_clock', 'observationTimeMs': 'measurement_run_clock',
                       'videoTimeMs': 'video_clock', 'maximumGapMs': 250},
            'references': [{'id': reference, 'runId': run, 'participantCode': participant, 'observationTimeMs': 0,
                            'poseModelId': model, 'values': baseline}], 'rows': rows}


def synthetic_manual(participant='synthetic_train', purpose='training_normal'):
    return {'schema_version': 'normal-posture-collection-v1', 'id': f'manual_{participant}', 'source': 'webcam', 'explicitSynthetic': True,
            'label': 'normal_assumed', 'review': 'user_confirmed_normal', 'featureVersion': COLLECTION_FEATURE,
            'createdAt': '2026-10-14T00:00:00Z', 'validMs': 30_000,
            'metadata': {'participantCode': participant, 'sessionCode': 'synthetic_session', 'purpose': purpose, 'poseModelId': SYNTHETIC_MODEL_ID},
            'timing': {'unit': 'ms', 'origin': 'explicit_collection_start', 'preparationMs': 3000, 'maxGapMs': 250, 'interpolation': False},
            'frames': [synthetic_frame(i) for i in range(301)], 'gaps': []}


def write_synthetic_manifest(folder, pilot=False):
    folder = private_path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    names = ['synthetic_train'] if pilot else ['synthetic_train', 'synthetic_validation', 'synthetic_test']
    files = []
    for i, name in enumerate(names):
        path = folder / f'{name}.json'
        path.write_text(json.dumps(synthetic_collection(name, phase=i * .2)), encoding='utf-8')
        files.append({'path': path.name, 'sha256': sha256(path)})
    manifest = {'schema_version': 'mediapipe-lstm-manifest-v1', 'poseModelId': SYNTHETIC_MODEL_ID, 'explicitSynthetic': True,
                'participants': {'train': names[:1], 'validation': names[1:2], 'test': names[2:3]}, 'files': files}
    path = folder / 'explicit-synthetic-manifest.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = private_path(args.output)
    if output.exists():
        parser.error('Choose a new output directory for the explicit synthetic smoke.')
    manifest = write_synthetic_manifest(output / 'explicit-synthetic-inputs')
    report = train(prepare(manifest), output / 'trained', epochs=2, threads=1)
    print(json.dumps({'explicit_synthetic': True, 'output': str(output), 'windows': report['training']['split_window_counts'],
                      'posture_accuracy': report['posture_accuracy']}))


if __name__ == '__main__':
    main()
