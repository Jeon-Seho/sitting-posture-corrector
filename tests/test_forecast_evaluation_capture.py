"""Evaluation-only capture guards. Every observation and identity is synthetic."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from model.analysis.mediapipe_data import (collection_frames, create_pilot_manifest,
                                         evaluation_frames, prepare, sha256, windows_for_frames)
from model.analysis.mediapipe_smoke import SYNTHETIC_MODEL_ID, synthetic_manual


def synthetic_evaluation():
    data = synthetic_manual(participant='synthetic_evaluation')
    data.pop('label')
    data.update({'schema_version': 'forecast-evaluation-collection-v1', 'dataRole': 'evaluation_only',
                 'trainingAllowed': False, 'review': 'user_confirmed_evaluation', 'collectionMethod': 'manual_30s'})
    data['metadata']['purpose'] = 'forecast_evaluation'
    for frame in data['frames']:
        frame['timeMs'] += 3000
    return data


class ForecastEvaluationCaptureTests(unittest.TestCase):
    def test_evaluation_is_unlabeled_and_yields_only_heldout_windows(self):
        data = synthetic_evaluation()
        frames = evaluation_frames(data, SYNTHETIC_MODEL_ID)
        self.assertEqual(len(frames), 301)
        self.assertEqual({frame.label for frame in frames}, {'evaluation_only'})
        windows = windows_for_frames(frames)
        self.assertEqual(len(windows), 269)
        self.assertEqual({window.label for window in windows}, {'evaluation_only'})
        self.assertEqual((windows[0].input_start_ms, windows[0].target_ms), (3000, 6200))
        self.assertNotIn('label', data)
        self.assertNotIn('profile', data)

    def test_normal_exports_cannot_be_used_as_dedicated_evaluation(self):
        for purpose in ('personal_calibration', 'training_normal'):
            with self.subTest(purpose=purpose), self.assertRaisesRegex(ValueError, 'dedicated'):
                evaluation_frames(synthetic_manual(purpose=purpose), SYNTHETIC_MODEL_ID)

    def test_evaluation_provenance_and_purpose_are_mandatory(self):
        corruptions = [('dataRole', 'training'), ('trainingAllowed', True), ('review', 'user_confirmed_normal'),
                       ('collectionMethod', 'automatic'), ('featureVersion', 'unknown'), ('label', 'normal_assumed'),
                       ('labelDisplay', 'normal'), ('profile', {}), ('timing', {}), ('metadata', {})]
        for field, value in corruptions:
            data = synthetic_evaluation(); data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                evaluation_frames(data, SYNTHETIC_MODEL_ID)
        data = synthetic_evaluation(); data['metadata']['purpose'] = 'training_normal'
        with self.assertRaisesRegex(ValueError, 'purpose'):
            evaluation_frames(data, SYNTHETIC_MODEL_ID)
        data = synthetic_evaluation(); data['frames'][0]['label'] = 'normal_assumed'
        with self.assertRaisesRegex(ValueError, 'labels'):
            evaluation_frames(data, SYNTHETIC_MODEL_ID)

    def test_quality_timing_extractor_and_stored_values_are_revalidated(self):
        for corruption in ('quality', 'values', 'model', 'time', 'video', 'duration', 'preparation', 'gap'):
            data = synthetic_evaluation()
            if corruption == 'quality': data['frames'][20]['image'][0]['visibility'] = .2
            if corruption == 'values': data['frames'][20]['values'][0] += .01
            if corruption == 'model': data['frames'][20]['poseModelId'] = 'unknown'
            if corruption == 'time': data['frames'][20]['timeMs'] = data['frames'][19]['timeMs']
            if corruption == 'video': data['frames'][20]['videoTimeMs'] = data['frames'][19]['videoTimeMs']
            if corruption == 'duration': data['validMs'] += 100
            if corruption == 'preparation':
                for frame in data['frames']: frame['timeMs'] -= 3000
            if corruption == 'gap': data['gaps'] = [{'timeMs': 4500, 'reason': 'quality'}]
            with self.subTest(corruption=corruption), self.assertRaises(ValueError):
                evaluation_frames(data, SYNTHETIC_MODEL_ID)

    def test_gap_boundaries_are_not_bridged_by_evaluation_windows(self):
        data = synthetic_evaluation()
        data['frames'].append(copy.deepcopy(data['frames'][-1]))
        data['frames'][-1]['timeMs'] += 100
        data['frames'][-1]['videoTimeMs'] += 100
        for frame in data['frames'][150:]: frame['segment'] = 1
        data['gaps'] = [{'timeMs': data['frames'][150]['timeMs'], 'reason': 'quality'}]
        windows = windows_for_frames(evaluation_frames(data, SYNTHETIC_MODEL_ID))
        boundary = data['frames'][150]['timeMs']
        self.assertTrue(windows)
        self.assertTrue(all(window.target_ms < boundary or window.input_start_ms >= boundary for window in windows))

    def test_every_evaluation_marker_blocks_training_even_in_pilot_mode(self):
        for marker in ('schema_version', 'metadata', 'dataRole', 'trainingAllowed'):
            data = synthetic_manual()
            data[marker] = synthetic_evaluation()[marker]
            for mode in ('pilot', 'participant_holdout'):
                with self.subTest(marker=marker, mode=mode), self.assertRaisesRegex(ValueError, 'Evaluation-only'):
                    collection_frames(data, SYNTHETIC_MODEL_ID, mode)

    def test_manifest_creation_and_preparation_refuse_evaluation_without_output(self):
        with tempfile.TemporaryDirectory(prefix='explicit-synthetic-evaluation-') as temp:
            folder = Path(temp)
            source = folder / 'synthetic-evaluation.json'
            source.write_text(json.dumps(synthetic_evaluation()))
            output = folder / 'should-not-be-created.json'
            with self.assertRaisesRegex(ValueError, 'Evaluation-only'):
                create_pilot_manifest([source], output)
            self.assertFalse(output.exists())
            manifest = {'schema_version': 'mediapipe-lstm-manifest-v1', 'poseModelId': SYNTHETIC_MODEL_ID,
                        'participants': {'train': ['synthetic_evaluation'], 'validation': [], 'test': []},
                        'files': [{'path': str(source), 'sha256': sha256(source)}]}
            manifest_path = folder / 'synthetic-manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'Evaluation-only'):
                prepare(manifest_path, 'pilot')


if __name__ == '__main__':
    unittest.main()
