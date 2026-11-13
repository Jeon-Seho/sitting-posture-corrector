#!/usr/bin/env python3
"""
(D-92) 좌표 적재 토픽 posture.keypoints.v1 시험 메시지 — 합성 좌표 구간을 "키|봉투 JSON" 줄로 표준 출력에 낸다.
kafka-console-producer가 그대로 받는다(통합 테스트 17단계):

    python3 tools/platform/replay_keypoints_v1.py --session-id <uuid> \\
      | docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 \\
          --topic posture.keypoints.v1 --property parse.key=true --property key.separator='|'

구간은 replay_realtime_v1.py 기본 시나리오와 같은 170개(0.5초, sequence 0부터, 85초)이고 구간마다 프레임 4장(125ms).
본문은 앱이 보내는 좌표 구간 계약(contracts/realtime/frames/posture-frames.v1.schema.json) 그대로다.
좌표는 합성 값(기준 자세 근처 고정점 + 나쁜 자세 구간은 머리 점을 아래로)이며 실제 사람의 측정값이 아니다.
"""
import argparse
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone

# 관절 9개(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨) 합성 기준점 (x, y)
BASE = [(0.51234, 0.40211), (0.53011, 0.3712), (0.49012, 0.372), (0.56021, 0.39012), (0.46011, 0.391),
        (0.52, 0.44), (0.5, 0.44), (0.66011, 0.62), (0.36012, 0.62)]


def frame(t_ms, drop):
    points = [[round(x, 5), round(y + (drop if i < 7 else 0.0), 5), 0.95] for i, (x, y) in enumerate(BASE)]
    return {"t_ms": t_ms, "p": points}


def build(session_id, user_id, start, normal_sec, bad_sec, recover_sec, segment_ms):
    lines, seq, t = [], 0, 0
    for seconds, drop in ((normal_sec, 0.0), (bad_sec, 0.1), (recover_sec, 0.0)):
        for _ in range(int(round(seconds * 1000 / segment_ms))):
            body = {"schema_version": "3.0", "feature_version": "keypoints-9-v1", "sequence": seq,
                    "start_ms": t, "end_ms": t + segment_ms, "phase": "running",
                    "frames": [frame(t + k * segment_ms // 4, drop) for k in range(4)]}
            produced = (start + timedelta(milliseconds=t + segment_ms)).isoformat(timespec="milliseconds")
            envelope = {"schema_version": "1.0", "message_id": str(uuid.uuid4()), "session_id": session_id,
                        "user_id": user_id, "produced_at": produced.replace("+00:00", "Z"), "kind": "keypoints",
                        "body": body}
            lines.append(session_id + "|" + json.dumps(envelope, separators=(",", ":")))
            seq += 1
            t += segment_ms
    return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--session-id", required=True)
    ap.add_argument("--user-id", default="KEYPOINTS-REPLAY")
    ap.add_argument("--normal-sec", type=float, default=5.0)
    ap.add_argument("--bad-sec", type=float, default=70.0)
    ap.add_argument("--recover-sec", type=float, default=10.0)
    ap.add_argument("--segment-ms", type=int, default=500)
    args = ap.parse_args(argv)
    try:
        uuid.UUID(args.session_id)
    except ValueError:
        ap.error("--session-id는 UUID")
    lines = build(args.session_id, args.user_id, datetime.now(timezone.utc), args.normal_sec, args.bad_sec,
                  args.recover_sec, args.segment_ms)
    sys.stdout.write("".join(line + "\n" for line in lines))
    print(f"좌표 구간 {len(lines)}개 (session {args.session_id})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
