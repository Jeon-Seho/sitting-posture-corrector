"""T-15 추론 동등성: 처리 서비스 추론(app.realtime)을 공용 합성 시험 데이터와 비교한다.

기대값은 팀 추론(model/inference, FastAPI /v2/infer)으로 만들었다 — 저장소 루트 tests/test_realtime_parity.py가
같은 파일로 팀 추론을 확인한다. 두 추론이 같은 입력에 같은 관측을 낸다는 근거(계획 0031, D-57).
"""

import json
import math
from pathlib import Path

from app.realtime import observation_from_features

CASES = Path(__file__).resolve().parents[3] / "contracts" / "realtime" / "parity" / "inference-cases.v1.json"


def test_processing_inference_matches_the_shared_cases():
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 100
    for case in cases:
        actual = observation_from_features(case["request"])
        expected = dict(case["expected"])
        assert math.isclose(actual.pop("collapse_probability"), expected.pop("collapse_probability"),
                            rel_tol=0, abs_tol=1e-12), case["request"]["sequence"]
        assert actual == expected, case["request"]["sequence"]
