"""
posture.inference 메시지 키 단위 테스트.

파티션을 여러 개로 늘린 뒤에도 같은 세션의 추론 결과가 항상 같은 파티션으로
가야 api-server 상태머신의 판정 순서가 지켜진다. (D-21) 키 = sessionId.
"""
from app.consumer import _partition_key


def test_key_is_session_id():
    assert _partition_key({"userId": "P01", "sessionId": "s-1"}) == "s-1"


def test_falls_back_to_user_id_when_session_id_missing():
    assert _partition_key({"userId": "P01", "sessionId": None}) == "P01"
    assert _partition_key({"userId": "P01", "sessionId": ""}) == "P01"


def test_none_when_both_missing():
    assert _partition_key({}) is None
