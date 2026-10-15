"""Actual CPU fitting on explicitly synthetic observations; no camera/user data."""
import contextlib
from dataclasses import replace
import importlib.util
import io
import json
import math
from pathlib import Path
import tempfile
import unittest

from model.analysis.mediapipe_data import prepare, sha256
from model.analysis.mediapipe_lstm import train
from model.analysis.mediapipe_smoke import write_synthetic_manifest


@unittest.skipUnless(importlib.util.find_spec('torch') and importlib.util.find_spec('numpy'),
                     'Optional training dependencies missing; make setup installs them for the full gate.')
class MediaPipeTrainingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='explicit-synthetic-mediapipe-training-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def fit(self, prepared, name):
        with contextlib.redirect_stdout(io.StringIO()):
            report = train(prepared, self.folder / name, epochs=1, threads=1)
        return report, json.loads((self.folder / name / 'model.json').read_text())

    def test_actual_fit_exports_browser_shape_and_separate_observed_forecast_metrics(self):
        prepared = prepare(write_synthetic_manifest(self.folder / 'fixtures'))
        report, model = self.fit(prepared, 'trained')
        self.assertEqual(model['schema_version'], 'forecast-weights-v2')
        self.assertTrue(model['model_id'].startswith('explicit-synthetic-mediapipe-lstm-'))
        self.assertEqual(model['data_domain'], 'mediapipe')
        self.assertFalse(model['domain_validated'])
        self.assertTrue(model['training']['participant_generalization_evaluated'])
        self.assertFalse(prepared.report['training']['participant_generalization_evaluated'])
        self.assertEqual(model['source_sha256'], sha256(self.folder / 'trained/research-lstm.pt'))
        self.assertIsNone(report['posture_accuracy'])
        self.assertFalse(report['browser_model_installed'])
        self.assertEqual(report['normalization']['fitted_on'], 'training_input_windows_only')
        sizes = {'lstm.weight_ih_l0': 192 * 39, 'lstm.weight_hh_l0': 192 * 48,
                 'lstm.bias_ih_l0': 192, 'lstm.bias_hh_l0': 192, 'output.weight': 39 * 48, 'output.bias': 39}
        self.assertEqual(set(model['weights']), set(sizes))
        for key, count in sizes.items():
            self.assertEqual(len(model['weights'][key]), count)
            self.assertTrue(all(math.isfinite(value) for value in model['weights'][key]))
        for split in ('train', 'validation', 'test'):
            self.assertEqual(set(report['forecast_metrics'][split]), {'lstm', 'hold_last', 'constant_velocity'})
            self.assertTrue(all(value >= 0 and math.isfinite(value)
                                for method in report['forecast_metrics'][split].values() for value in method.values()))
        text = json.dumps(model)
        self.assertNotIn('synthetic_train', text)
        self.assertNotIn(str(self.folder), text)
        with self.assertRaisesRegex(ValueError, 'never overwritten'):
            train(prepared, self.folder / 'trained', epochs=1)

    def test_test_coordinates_cannot_change_fitting_normalization_or_checkpoint_selection(self):
        prepared = prepare(write_synthetic_manifest(self.folder / 'fixtures'))
        original_report, original = self.fit(prepared, 'first')
        prepared.windows['test'] = [replace(window, inputs=tuple(tuple(value + 1 for value in row) for row in window.inputs),
                                            target=tuple(value + 2 for value in window.target)) for window in prepared.windows['test']]
        changed_report, changed = self.fit(prepared, 'second')
        for key in ('mean', 'scale', 'weights'):
            self.assertEqual(original[key], changed[key], key)
        self.assertEqual(original_report['selected_epoch'], changed_report['selected_epoch'])
        self.assertEqual(original_report['history'], changed_report['history'])
        self.assertNotEqual(original_report['forecast_metrics']['test'], changed_report['forecast_metrics']['test'])

    def test_pilot_trains_but_never_reports_independent_evaluation(self):
        prepared = prepare(write_synthetic_manifest(self.folder / 'fixtures', pilot=True), 'pilot')
        report, model = self.fit(prepared, 'pilot')
        self.assertEqual(model['training']['evaluation_scope'], 'training_fit_only')
        self.assertFalse(model['training']['participant_generalization_evaluated'])
        self.assertIsNone(report['forecast_metrics']['validation'])
        self.assertIsNone(report['forecast_metrics']['test'])
        self.assertNotIn('validation_mse', report['history'][0])
        self.assertEqual(report['selection'], 'last_epoch_no_evaluation')


if __name__ == '__main__':
    unittest.main()
