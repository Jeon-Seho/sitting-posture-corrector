"""Standard-library-only checks. All fixture observations are explicitly synthetic."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from model.analysis.mediapipe_data import (Frame, KNOWN_POSE_MODELS, ROOT, collection_frames, create_pilot_manifest, normalized_values, prepare, private_path,
                                         sha256, windows_for_frames)
from model.analysis.mediapipe_lstm import fit_scaler
from model.analysis.mediapipe_smoke import (SYNTHETIC_MODEL_ID, synthetic_collection, synthetic_manual,
                                          write_synthetic_manifest)


class MediaPipePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='explicit-synthetic-mediapipe-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def manifest(self, collections, participants=None, **changes):
        files = []
        for i, data in enumerate(collections):
            path = self.folder / f'synthetic-{i}.json'
            path.write_text(json.dumps(data), encoding='utf-8')
            files.append({'path': path.name, 'sha256': sha256(path)})
        manifest = {'schema_version': 'mediapipe-lstm-manifest-v1', 'poseModelId': SYNTHETIC_MODEL_ID,
                    'participants': participants or {'train': ['synthetic_train'], 'validation': [], 'test': []},
                    'files': files, 'explicitSynthetic': True, **changes}
        path = self.folder / 'manifest.json'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        return path

    def test_all_three_export_schemas_and_label_provenance(self):
        for version in (1, 2):
            result = prepare(self.manifest([synthetic_collection(version=version)]), 'pilot')
            self.assertEqual(len(result.windows['train']), 28)
            self.assertEqual(result.report['training']['labels_used'], {'manual_confirmed_windows': 0, 'automatic_weak_windows': 28})
        result = prepare(self.manifest([synthetic_manual()]), 'pilot')
        self.assertEqual(len(result.windows['train']), 269)
        self.assertEqual(result.report['training']['labels_used']['manual_confirmed_windows'], 269)
        self.assertFalse(result.report['training']['participant_generalization_evaluated'])

    def test_review_required_automatic_data_is_blocked_before_window_creation(self):
        for gate in ({'status': 'requires_review', 'affectedRows': 613}, None, {'status': 'unrecognized'}):
            data = synthetic_collection()
            data['reviewGate'] = gate
            data['trainingAllowed'] = False
            with self.subTest(gate=gate), self.assertRaisesRegex(ValueError, 'Review-required'):
                prepare(self.manifest([data]), 'pilot')
            with self.assertRaisesRegex(ValueError, 'Review-required'):
                create_pilot_manifest([self.folder / 'synthetic-0.json'], self.folder / 'blocked-manifest.json')
            self.assertFalse((self.folder / 'blocked-manifest.json').exists())

    def test_clean_auto_selection_checks_scores_stability_and_policy_provenance(self):
        data = synthetic_collection()
        data['selection']['cleanGate'] = {'policy': 'auto-normal-clean-v1', 'maximumPostureScore': .5, 'minimumStableMs': 1000,
                                          'requiredRuleState': 'near_reference', 'imagePosturePolicy': 'image-posture-anchor-v2'}
        for row in data['rows']:
            row['observationTimeMs'] += 1000
            row.update(selectionPolicy='auto-normal-clean-v1', imagePosturePolicy='image-posture-anchor-v2',
                       postureScore=.2, imagePostureScore=.1, stableForMs=1000)
        result = prepare(self.manifest([data]), 'pilot')
        self.assertTrue(result.windows['train'])
        for field, value in (('postureScore', .51), ('postureScore', None), ('stableForMs', 999),
                             ('selectionPolicy', 'old'), ('imagePosturePolicy', 'image-posture-anchor-v1'), ('imagePostureScore', -.1)):
            invalid = copy.deepcopy(data); invalid['rows'][10][field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, 'clean selection'):
                prepare(self.manifest([invalid]), 'pilot')

    def test_participant_split_is_explicit_and_disjoint_before_windowing(self):
        manifest = write_synthetic_manifest(self.folder)
        prepared = prepare(manifest)
        for split in ('train', 'validation', 'test'):
            self.assertEqual({window.participant for window in prepared.windows[split]}, {f'synthetic_{split}'})
        data = json.loads(manifest.read_text())
        data['participants']['test'] = ['synthetic_train']
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'overlap'):
            prepare(manifest)

    def test_pilot_cannot_silently_absorb_holdout_and_standard_requires_holdout(self):
        manifest = write_synthetic_manifest(self.folder)
        with self.assertRaisesRegex(ValueError, 'train-only'):
            prepare(manifest, 'pilot')
        manifest = self.manifest([synthetic_collection()])
        with self.assertRaisesRegex(ValueError, 'validation and test'):
            prepare(manifest)

    def test_unknown_participant_and_duplicate_export_fail(self):
        with self.assertRaisesRegex(ValueError, 'missing from'):
            prepare(self.manifest([synthetic_collection('someone_else')]), 'pilot')
        with self.assertRaisesRegex(ValueError, 'Duplicate source'):
            prepare(self.manifest([synthetic_collection(), synthetic_collection()]), 'pilot')
        second = synthetic_collection(); second['createdAt'] = '2026-10-15T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Repeated collection'):
            prepare(self.manifest([synthetic_collection(), second]), 'pilot')

    def test_file_hash_and_model_provenance_must_match(self):
        manifest = self.manifest([synthetic_collection()])
        source = self.folder / 'synthetic-0.json'; source.write_text(source.read_text() + ' ')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            prepare(manifest, 'pilot')
        for model in (None, 'other-model'):
            data = synthetic_collection()
            if model is None:
                data['rows'][5].pop('poseModelId')
            else:
                data['rows'][5]['poseModelId'] = model
            with self.assertRaisesRegex(ValueError, 'poseModelId'):
                prepare(self.manifest([data]), 'pilot')
        with self.assertRaisesRegex(ValueError, 'supported'):
            prepare(self.manifest([synthetic_collection()], poseModelId='unknown-extractor'), 'pilot')
        configured = json.loads((ROOT / 'frontend/model-variants.json').read_text())
        self.assertEqual(KNOWN_POSE_MODELS, {value['modelId'] for value in configured.values()})

    def test_invalid_json_shape_is_refused_without_a_traceback(self):
        with self.assertRaisesRegex(ValueError, 'object'):
            prepare(self.manifest([[]]), 'pilot')
        for field in ('timing', 'selection'):
            data = synthetic_collection(); data[field] = []
            with self.assertRaises(ValueError):
                prepare(self.manifest([data]), 'pilot')

    def test_values_are_recomputed_and_low_quality_never_becomes_training(self):
        for change in ('values', 'visibility', 'outside', 'nan', 'span'):
            data = synthetic_collection()
            row = data['rows'][5]
            if change == 'values': row['values'][0] += .01
            if change == 'visibility': row['image'][0]['visibility'] = .4
            if change == 'outside': row['image'][0]['x'] = 1.5
            if change == 'nan': row['world'][0]['x'] = float('nan')
            if change == 'span': row['world'][12] = copy.deepcopy(row['world'][11])
            with self.subTest(change=change), self.assertRaises(ValueError):
                prepare(self.manifest([data]), 'pilot')

    def test_automatic_thresholds_and_reference_distance_are_not_trusted(self):
        for threshold in (.005, .03, .06):
            prepared = prepare(self.manifest([synthetic_collection(threshold=threshold)]), 'pilot')
            self.assertTrue(prepared.windows['train'])
        for corruption in ('threshold', 'distance', 'reference', 'label'):
            data = synthetic_collection(); row = data['rows'][10]
            if corruption == 'threshold': row['maximumDeviation'] = .12
            if corruption == 'distance': row['deviation'] = .02
            if corruption == 'reference': row['referenceId'] = 'unowned'
            if corruption == 'label': row['label'] = 'normal_assumed'
            with self.subTest(corruption=corruption), self.assertRaises(ValueError):
                prepare(self.manifest([data]), 'pilot')

    def test_raw_and_video_clocks_cannot_reverse_even_across_segments(self):
        for clock in ('timeMs', 'observationTimeMs', 'videoTimeMs'):
            data = synthetic_collection(); data['rows'][10][clock] = data['rows'][9][clock]
            data['rows'][10]['segment'] = 1
            with self.subTest(clock=clock), self.assertRaisesRegex(ValueError, 'reversed|duplicated'):
                prepare(self.manifest([data]), 'pilot')

    def test_short_segments_are_not_stitched_and_exact_3200ms_produces_one_window(self):
        data = synthetic_collection(count=33)
        frames = collection_frames(data, SYNTHETIC_MODEL_ID, 'pilot')
        windows = windows_for_frames(frames)
        self.assertEqual(len(windows), 1)
        self.assertEqual((windows[0].input_start_ms, windows[0].input_end_ms, windows[0].target_ms), (0, 2900, 3200))
        data = synthetic_collection(count=60)
        for row in data['rows'][30:]: row['segment'] = 1
        with self.assertRaisesRegex(ValueError, '3.2 seconds'):
            prepare(self.manifest([data]), 'pilot')

    def test_session_reference_participant_threshold_and_gap_boundaries_do_not_cross(self):
        values = tuple([0.] * 39)
        for change in ('key', 'participant', 'time_gap', 'video_gap', 'threshold'):
            frames = []
            for i in range(60):
                later = i >= 30
                key = ('session', 'reference', .03)
                if later and change == 'key': key = ('different_session', 'reference', .03)
                if later and change == 'threshold': key = ('session', 'reference', .06)
                frames.append(Frame('second_person' if later and change == 'participant' else 'one_person', key,
                                    i * 100 + (200 if later and change == 'time_gap' else 0),
                                    i * 100 + (200 if later and change == 'video_gap' else 0), values, 'automatic_weak'))
            self.assertEqual(windows_for_frames(frames), [], change)

    def test_irregular_valid_endpoints_resample_without_extrapolation(self):
        frames = [Frame('synthetic_train', ('session',), i * 125, i * 125, tuple([i * .01] * 39), 'automatic_weak') for i in range(28)]
        windows = windows_for_frames(frames)
        self.assertEqual(len(windows), 2)
        self.assertAlmostEqual(windows[0].inputs[1][0], .008)
        self.assertAlmostEqual(windows[0].target[0], .26)
        self.assertEqual(windows[0].target_ms, 3250)
        self.assertEqual(windows[0].nominal_target_ms, 3200)
        self.assertTrue(all(window.input_observed_through_ms < window.target_ms for window in windows))
        self.assertTrue(all(window.target in [frame.values for frame in frames] for window in windows))
        self.assertLessEqual(windows[-1].target_ms, frames[-1].time)

    def test_targets_outside_tolerance_are_excluded_and_never_interpolated(self):
        frames = [Frame('synthetic_train', ('session',), i * 240, i * 240, tuple([i * .01] * 39), 'automatic_weak') for i in range(20)]
        from collections import Counter
        stats = Counter()
        windows = windows_for_frames(frames, stats)
        self.assertGreater(stats['discarded_target_windows'], 0)
        for window in windows:
            self.assertLessEqual(abs(window.target_ms - window.nominal_target_ms), 50)
            self.assertLess(window.input_observed_through_ms, window.target_ms)
            self.assertIn(window.target, [frame.values for frame in frames])
        times = list(range(0, 2900, 100)) + [3050, 3150, 3300]
        frames = [Frame('synthetic_train', ('session',), time, time, tuple([time * .0001] * 39), 'automatic_weak') for time in times]
        window = windows_for_frames(frames)[0]
        self.assertEqual((window.input_end_ms, window.input_observed_through_ms, window.target_ms), (2900, 3050, 3150))
        self.assertEqual(window.target_ms - window.input_end_ms, 250)
        self.assertEqual(window.target_ms - window.input_observed_through_ms, 100)

    def test_window_limit_interrupts_generation_and_export_row_limits_are_checked(self):
        frames = collection_frames(synthetic_collection(), SYNTHETIC_MODEL_ID, 'pilot')
        from collections import Counter
        stats = Counter()
        with self.assertRaisesRegex(ValueError, 'Too many windows'):
            windows_for_frames(frames, stats, maximum_windows=2)
        self.assertEqual(stats['candidate_windows'], 3)
        for data, rows_key, maximum in ((synthetic_collection(), 'rows', 6000), (synthetic_manual(), 'frames', 1200)):
            data[rows_key] = [data[rows_key][0]] * (maximum + 1)
            with self.assertRaisesRegex(ValueError, 'rows|frames'):
                collection_frames(data, SYNTHETIC_MODEL_ID, 'pilot')

    def test_pilot_manifest_uses_actual_ids_and_hashes_then_is_directly_trainable(self):
        self.manifest([synthetic_collection()])
        generated = self.folder / 'new-manifest.json'
        summary = create_pilot_manifest([self.folder / 'synthetic-0.json'], generated)
        self.assertEqual(summary['usable_windows'], 28)
        data = json.loads(generated.read_text())
        self.assertEqual(data['poseModelId'], SYNTHETIC_MODEL_ID)
        self.assertTrue(data['explicitSynthetic'])
        self.assertEqual(data['files'][0]['sha256'], sha256(self.folder / 'synthetic-0.json'))
        self.assertEqual(len(prepare(generated, 'pilot').windows['train']), 28)
        with self.assertRaisesRegex(ValueError, 'never overwritten'):
            create_pilot_manifest([self.folder / 'synthetic-0.json'], generated)

    def test_pilot_manifest_refuses_multi_participant_or_mixed_extractors(self):
        self.manifest([synthetic_collection(), synthetic_collection('someone_else')])
        with self.assertRaisesRegex(ValueError, 'single-participant'):
            create_pilot_manifest([self.folder / 'synthetic-0.json', self.folder / 'synthetic-1.json'], self.folder / 'new.json')
        self.assertFalse((self.folder / 'new.json').exists())
        data = synthetic_collection('other_session')
        data['references'][0]['poseModelId'] = 'mediapipe-pose-heavy-f16-v1/tasks-vision-1.0.1'
        self.manifest([synthetic_collection(), data])
        with self.assertRaisesRegex(ValueError, 'Mixed poseModelId'):
            create_pilot_manifest([self.folder / 'synthetic-0.json', self.folder / 'synthetic-1.json'], self.folder / 'new.json')

    def test_personal_reference_is_not_global_training_or_test_material(self):
        data = synthetic_manual(purpose='personal_calibration')
        with self.assertRaisesRegex(ValueError, 'personal_calibration'):
            collection_frames(data, SYNTHETIC_MODEL_ID, 'participant_holdout')
        self.assertTrue(collection_frames(data, SYNTHETIC_MODEL_ID, 'pilot'))

    def test_manual_review_duration_and_feature_definition_are_required(self):
        for field, value in [('review', 'not_reviewed'), ('validMs', 99999), ('featureVersion', 'unknown')]:
            data = synthetic_manual(); data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                prepare(self.manifest([data]), 'pilot')
        data = synthetic_manual()
        data['gaps'] = [{'timeMs': 450, 'reason': 'quality'}]
        with self.assertRaisesRegex(ValueError, 'gap must separate'):
            prepare(self.manifest([data]), 'pilot')

    def test_scaler_uses_train_only_and_private_outputs_cannot_replace_frontend_asset(self):
        prepared = prepare(write_synthetic_manifest(self.folder))
        mean, scale = fit_scaler(prepared.windows['train'])
        prepared.windows['test'].clear(); prepared.windows['validation'].clear()
        self.assertEqual((mean, scale), fit_scaler(prepared.windows['train']))
        self.assertTrue(all(value >= .02 for value in scale))
        with self.assertRaisesRegex(ValueError, 'Private inputs/outputs'):
            private_path('frontend/public/research-model/forecast.json')

    def test_cli_dry_run_imports_without_site_packages_and_reports_no_actual_training(self):
        manifest = self.manifest([synthetic_collection()])
        result = subprocess.run([sys.executable, '-S', '-m', 'model.analysis.mediapipe_lstm', 'prepare', '--manifest', str(manifest), '--mode', 'pilot'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report['training']['participant_generalization_evaluated'])
        self.assertIsNone(report['posture_accuracy'])
        self.assertFalse((self.folder / 'model.json').exists())
        output = self.folder / 'generated.json'
        result = subprocess.run([sys.executable, '-S', '-m', 'model.analysis.mediapipe_lstm', 'manifest', '--mode', 'pilot',
                                 '--output', str(output), str(self.folder / 'synthetic-0.json')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(prepare(output, 'pilot').windows['train']), 28)


if __name__ == '__main__':
    unittest.main()
