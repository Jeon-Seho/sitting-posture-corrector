#!/usr/bin/env python3
"""
(D-21) 실시간 계약 v1 재생 도구 — 합성 세션 1개를 posture.features.v1 메시지로 만들어
api-server의 시험용 입구(POST /api/v1/realtime/features)로 보낸다.

    python3 mysql/replay_realtime_v1.py                      # T-10과 같은 시나리오(정상 5s → 나쁜 자세 70s → 회복 10s)
    python3 mysql/replay_realtime_v1.py --pace realtime      # 실제 시간처럼 0.5초마다
    python3 mysql/replay_realtime_v1.py --user-id IT-V1-001 --bad-sec 10
    # (D-37) 재시작 시험: 같은 세션을 두 번에 나눠 보낸다(메시지 번호 0부터, 끝 번호는 포함 안 함)
    python3 mysql/replay_realtime_v1.py --session-id <uuid> --range 0:60    # 시작 + 구간 sequence 0~58
    docker compose restart api-server                                       # 판정 상태는 Redis에서 복원
    python3 mysql/replay_realtime_v1.py --session-id <uuid> --range 60:     # 나머지 + 종료

메시지: session_started(정책 3000/3000/60000/0.7) → features(0.5초 구간 1개씩, sequence 0부터) → session_ended.
특징 값은 T-10 CSV와 같다(나쁜 자세: 머리 0.18·좌우 0.15·어깨 -0.12, 정상: 0.02·0.01·-0.01, 품질 0.9).
합성 데이터이며 실제 사람의 측정값이 아니다. 원본 영상·좌표는 넣지 않는다.

판정 기대값(v1 판정기 D-22, 정책 3000/3000/60000/0.7, 유효 시간 누적):
collapse_confirmed 8000ms(시작 5000) → reminder 68000ms → recovery_confirmed 78000ms(실제 지속 73.0초) → session_ended 85000ms,
요약 collapse_count 1·alert_count 2·valid_ms 85000·mean_recovery_ms 70000. 결과: GET /cep/v1/sessions/<session_id>
"""
import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests

BAD = {"head_gap_delta": 0.18, "lateral_offset_delta": 0.15, "shoulder_tilt_delta": -0.12}
NORMAL = {"head_gap_delta": 0.02, "lateral_offset_delta": 0.01, "shoulder_tilt_delta": -0.01}


def iso(t: datetime) -> str:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def envelope(session_id, user_id, produced_at, kind, body):
    return {
        "schema_version": "1.0",
        "message_id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_id": user_id,
        "produced_at": iso(produced_at),
        "kind": kind,
        "body": body,
    }


def build_session(args, start: datetime):
    session_id = args.session_id or str(uuid.uuid4())
    baseline_id = str(uuid.uuid4())
    msgs = [envelope(session_id, args.user_id, start, "session_started", {
        "policy": {"hold_ms": 3000, "recovery_ms": 3000, "reminder_ms": 60000, "threshold": 0.7},
        "baseline_id": baseline_id,
        "frame": {"width": 640, "height": 480},
    })]
    seq, t = 0, 0
    seg = args.segment_ms
    for seconds, deltas in ((args.normal_sec, NORMAL), (args.bad_sec, BAD), (args.recover_sec, NORMAL)):
        for _ in range(int(round(seconds * 1000 / seg))):
            body = {
                "schema_version": "2.0",
                "feature_version": "shoulder-relative-deltas-v1",
                "baseline_id": baseline_id,
                "sequence": seq,
                "start_ms": t,
                "end_ms": t + seg,
                "phase": "running",
                "measurement_quality": "good",
                "features": {**deltas, "current_quality": 0.9, "baseline_quality": 0.9},
            }
            msgs.append(envelope(session_id, args.user_id, start + timedelta(milliseconds=t + seg), "features", body))
            seq += 1
            t += seg
    msgs.append(envelope(session_id, args.user_id, start + timedelta(milliseconds=t), "session_ended", {"end_ms": t}))
    return session_id, msgs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8080/api/v1/realtime/features")
    ap.add_argument("--user-id", default="V1-REPLAY")
    ap.add_argument("--session-id", default=None, help="지정하지 않으면 새 UUID")
    ap.add_argument("--normal-sec", type=float, default=5.0)
    ap.add_argument("--bad-sec", type=float, default=70.0)
    ap.add_argument("--recover-sec", type=float, default=10.0)
    ap.add_argument("--segment-ms", type=int, default=500)
    ap.add_argument("--batch", type=int, default=20, help="한 번의 HTTP 요청에 담을 메시지 수(1~200)")
    ap.add_argument("--pace", choices=["fast", "realtime"], default="fast",
                    help="fast: 최대 속도 / realtime: 구간 길이만큼 기다리며 1건씩")
    ap.add_argument("--dump", default=None, help="보낸 메시지를 JSON Lines 파일로도 저장")
    ap.add_argument("--range", default=None, metavar="A:B",
                    help="(D-37) 만든 메시지 중 [A, B) 번째만 보낸다. 같은 --session-id로 나눠 보낼 때")
    args = ap.parse_args()
    if not 1 <= args.batch <= 200 or not 1 <= args.segment_ms <= 1500:
        ap.error("--batch는 1~200, --segment-ms는 1~1500")

    start = datetime.now(timezone.utc)
    session_id, msgs = build_session(args, start)
    total = len(msgs)
    if args.range:
        try:
            a, b = args.range.split(":")
            lo, hi = int(a or 0), int(b) if b else total
        except ValueError:
            ap.error("--range는 A:B 형식 (예: 0:60, 60:)")
        if not 0 <= lo < hi <= total:
            ap.error(f"--range는 0 ≤ A < B ≤ {total}")
        msgs = msgs[lo:hi]
    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as f:
            for m in msgs:
                f.write(json.dumps(m, ensure_ascii=False) + "\n")

    batch = 1 if args.pace == "realtime" else args.batch
    sent, failed, t0 = 0, 0, time.time()
    with requests.Session() as http:
        for i in range(0, len(msgs), batch):
            chunk = msgs[i:i + batch]
            try:
                r = http.post(args.api, json=chunk if len(chunk) > 1 else chunk[0], timeout=10)
            except requests.RequestException as exc:
                print(f"[오류] 요청 실패: {exc}", file=sys.stderr)
                failed += len(chunk)
                break
            if r.status_code == 202:
                sent += len(chunk)
            else:
                failed += len(chunk)
                print(f"[오류] HTTP {r.status_code}: {r.text[:500]}", file=sys.stderr)
                break
            if args.pace == "realtime" and chunk[0]["kind"] == "features":
                time.sleep(args.segment_ms / 1000)

    print(f"[재생 v1] session_id = {session_id}")
    print(f"[재생 v1] user_id = {args.user_id}, 구간 {args.segment_ms}ms, 메시지 {total}개(시작 1 + 구간 {total - 2} + 종료 1)"
          + (f", 이번에 보낸 범위 {args.range} = {len(msgs)}개" if args.range else ""))
    print(f"[결과] {time.time() - t0:.2f}초 동안 전송 성공(202) {sent} / 실패 {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
