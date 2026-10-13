"""Explicit synthetic fixtures only; no participant data in tests."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from model.analysis.panoptic_lstm import FACE, BODY, Forecast, fit, frame_features, windows, private_path


def synthetic_rows(n=180):
    return [(i, i*1000/29.97, np.full(39, i/100, dtype=np.float32)) for i in range(n)]


def synthetic_frame():
    body = np.ones((19, 4)); body[3, :3] = [-10, 0, 0]; body[9, :3] = [10, 0, 0]
    face = {'landmarks': np.ones((70, 3)).ravel().tolist(), 'averageScore': [1]*70,
            'averageReproError': [1]*70, 'visibility': [[0, 1]]*70}
    return {'joints19': body.ravel().tolist()}, face


class PanopticLstmTests(unittest.TestCase):
    def test_quality_rejects_unmeasurable(self):
        b, f = synthetic_frame(); self.assertEqual(frame_features(b, f).shape, (39,))
        f['averageScore'][FACE[0]] = 0
        self.assertIsNone(frame_features(b, f))
        b, f = synthetic_frame(); f['visibility'][FACE[0]] = []
        self.assertIsNone(frame_features(b, f))
        b, f = synthetic_frame(); b['joints19'][BODY[0]*4+3] = float('nan')
        self.assertIsNone(frame_features(b, f))

    def test_translation_and_scale_invariance(self):
        b, f = synthetic_frame(); expected = frame_features(b, f)
        p = np.array(b['joints19']).reshape(19, 4); p[:, :3] = p[:, :3]*3+[5, 7, 9]
        q = np.array(f['landmarks']).reshape(70, 3)*3+[5, 7, 9]
        b['joints19'] = p.ravel().tolist(); f['landmarks'] = q.ravel().tolist()
        np.testing.assert_allclose(frame_features(b, f), expected)

    def test_windows_do_not_bridge_quality_gap_or_tracks(self):
        rows = synthetic_rows(240)
        x, y, owners = windows({0: rows[:105]+rows[130:], 1: synthetic_rows(120)})
        self.assertEqual(set(owners), {0, 1})
        for a, b in zip(x, y):
            self.assertAlmostEqual(float(b[0]-a[-1, 0]), .09, places=5)
            self.assertLess(float(np.diff(a[:, 0]).max()), .031)

    def test_time_reversal_and_invalid_settings_rejected(self):
        rows = synthetic_rows(); rows[20] = (20, 0, rows[20][2])
        with self.assertRaises(ValueError): windows({0: rows})
        with self.assertRaises(ValueError): windows({0: synthetic_rows()}, downsample=0)
        with self.assertRaises(ValueError): windows({0: synthetic_rows(20)})

    def test_holdout_not_used_in_train_windows(self):
        train = {0: synthetic_rows()}; holdout = {1: synthetic_rows()}
        a = windows(train)[0]; holdout[1][0][2][:] = 900
        np.testing.assert_array_equal(a, windows(train)[0])
        self.assertEqual(set(windows(train)[2]), {0})

    def test_actual_lstm_fit_save_reload_and_scope(self):
        x, y, _ = windows({0: synthetic_rows()})
        parent = private_path('runs/panoptic/synthetic-tests'); parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='explicit-synthetic-lstm-', dir=parent) as tmp:
            report = fit(x, y, Path(tmp), epochs=2)
            self.assertIsNone(report['test_metrics']); self.assertIsNone(report['posture_accuracy'])
            self.assertFalse(report['participant_generalization_evaluated'])
            bundle = torch.load(Path(tmp)/'research-lstm.pt', weights_only=True)
            model = Forecast(); model.load_state_dict(bundle['state_dict']); model.eval()
            with torch.no_grad(): prediction = model(torch.from_numpy(x))
            self.assertEqual(tuple(prediction.shape), (len(x), 39))
            self.assertTrue(torch.isfinite(prediction).all())

    def test_real_output_cannot_be_saved_in_source(self):
        with self.assertRaises(ValueError): private_path('model/unsafe.pt')


if __name__ == '__main__':
    unittest.main()
