"""Explicit synthetic policy counterexamples; no real motion data."""
import unittest

import numpy as np
import torch

from model.analysis.forecast_hybrid import Policy, Settings, causal_forecasts, distance, scenarios
from model.analysis.panoptic_lstm import Forecast


class ForecastHybridTests(unittest.TestCase):
    def test_abrupt_movement_is_pending_until_return(self):
        p=Policy()
        self.assertEqual(p.step(0,.3,.4,.02),'unexpected_motion_candidate')
        for i in range(1,10): p.step(i/10,.3,.4,.02)
        self.assertEqual(p.step(1,0,.4,.02),'near_reference')
        self.assertEqual([e['kind'] for e in p.events],['returned_excursion'])

    def test_high_error_cannot_suppress_sustained_deviation_forever(self):
        p=Policy()
        for i in range(51): state=p.step(i/10,.3,.4,.02)
        self.assertEqual(state,'persistent_deviation_candidate')
        self.assertTrue(p.events[0]['fallback']);self.assertEqual(p.events[0]['at'],5.)

    def test_low_error_still_requires_deviation_and_duration(self):
        p=Policy()
        for i in range(60): self.assertEqual(p.step(i/10,0,0,.02),'near_reference')
        for i in range(60,90): self.assertNotEqual(p.step(i/10,.3,0,.02),'persistent_deviation_candidate')
        self.assertEqual(p.step(9,.3,0,.02),'persistent_deviation_candidate')

    def test_predictable_returning_motion_is_still_temporary(self):
        p=Policy()
        for i in range(20): p.step(i/10,.3,0,.02)
        p.step(2,0,0,.02)
        self.assertEqual(p.events[0]['kind'],'returned_excursion')

    def test_quality_and_gap_break_accumulation(self):
        p=Policy(rule_only=True)
        for i in range(25): p.step(i/10,.3,0,.02)
        self.assertEqual(p.step(2.5,.3,0,.02,False),'unmeasurable')
        for i in range(26,50):self.assertNotEqual(p.step(i/10,.3,0,.02),'persistent_deviation_candidate')
        self.assertNotEqual(p.step(8,.3,0,.02),'persistent_deviation_candidate')
        self.assertEqual(p.far_since,8)

    def test_recovery_needs_duration_and_does_not_reclassify_episode(self):
        p=Policy(rule_only=True)
        for i in range(31):p.step(i/10,.3,0,.02)
        self.assertEqual(p.step(3.1,0,0,.02),'recovery_pending')
        for i in range(32,61):p.step(i/10,0,0,.02)
        self.assertEqual(p.step(6.1,0,0,.02),'near_reference')
        self.assertNotIn('returned_excursion',[e['kind'] for e in p.events])

    def test_hysteresis_and_reversed_time(self):
        p=Policy();p.step(0,.15,0,.02);p.step(.1,.1,0,.02)
        self.assertEqual(p.far_since,0)
        with self.assertRaises(ValueError):p.step(.1,.1,0,.02)
        with self.assertRaises(ValueError):Policy(Settings(near=.2))

    def test_forecasts_are_causal_and_cannot_bridge_quality(self):
        torch.set_num_threads(2);torch.manual_seed(42)
        case=scenarios()[0]; model=Forecast().eval()
        bundle={'mean':torch.zeros(39),'scale':torch.ones(39)}
        first=causal_forecasts(case['values'],case['time'],case['quality'],bundle,model)
        changed=case['values'].copy();changed[150:]+=10
        second=causal_forecasts(changed,case['time'],case['quality'],bundle,model)
        for k in first:np.testing.assert_array_equal(first[k][:150],second[k][:150])
        quality=case['quality'].copy();quality[100]=False
        third=causal_forecasts(case['values'],case['time'],quality,bundle,model)
        for k in third:self.assertTrue(np.isnan(third[k][100:133]).all())

    def test_feature_groups_are_equally_weighted(self):
        a=np.zeros((13,3));b=a.copy();b[:9,0]=1
        self.assertAlmostEqual(float(distance(a,b)[0]),1/3)
        b=a.copy();b[11:,0]=1
        self.assertAlmostEqual(float(distance(a,b)[0]),1/3)


if __name__=='__main__':unittest.main()
