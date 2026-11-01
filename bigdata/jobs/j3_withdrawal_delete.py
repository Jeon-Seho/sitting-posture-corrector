"""Spark 배치 J3 — 탈퇴 최종 삭제: 유예(30일)가 지난 탈퇴 계정의 HDFS 사용자 폴더와 DB 행을 지운다 (D-49).

규칙은 database/README.md 「탈퇴 최종 삭제」·「삭제 배치 공통」(V2.6):
- 대상: request_scope = ACCOUNT_ALL, 상태 REQUESTED·FAILED(재시도)·PROCESSING(앞 실행이 중간에 죽은 것 — 잠금으로
  한 번에 하나만 돌므로 시작할 때 남은 PROCESSING은 끝나지 않은 것), account_closed_at + 30일 ≤ 지금(KST).
- 사용자 한 명씩: ① 요청을 PROCESSING으로(확정) ② 사용자 폴더 /data/users/{id}와 폴더 밖 세션 폴더를 지우고
  feature_archive.deleted_at을 채움(확정, 재시도 지점) ③ 한 트랜잭션에서 적재 기록 → 세션(이벤트·알림·제외 구간 CASCADE)
  → 일별 통계 → 기준 자세 → 삭제 요청 → 계정(동의·로그인 유지 토큰 CASCADE).
- 실패하면 ③을 되돌리고 요청을 FAILED·사유로 둔다(다음 실행에서 다시). 성공하면 요청 행도 지워져 남는 것이 없다.
- RECORDS_ONLY(기록만 삭제)는 지금 입출구 서버가 만들지 않는다 — 개수만 알리고 건너뛴다.
- 완료 안내 발송은 수단이 정해지지 않아(남은 안건) 자리만 둔다. 이메일 등 개인정보는 읽지도 로그에 남기지도 않는다.

실행: tools/platform/batch.sh j3 [--user 12,34] [--dry-run] [--grace-days N(--user와 함께, 시험용)]
"""

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import batch_common as bc  # noqa: E402

JOB = "J3"
GRACE_DAYS = 30  # WITHDRAWAL_GRACE_DAY
RETRY_STATUSES = ("REQUESTED", "FAILED", "PROCESSING")


# ---------------------------------------------------------------------------
# 대상 고르기

def targets_sql(users):
    sql = ("SELECT user_account_id, DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s.%f') AS requested_at, request_status"
           " FROM deletion_request"
           " WHERE request_scope = 'ACCOUNT_ALL' AND account_closed_at IS NOT NULL AND account_closed_at <= ?"
           " AND request_status IN ('REQUESTED', 'FAILED', 'PROCESSING')")
    if users:
        sql += " AND user_account_id IN (" + ",".join("?" for _ in users) + ")"
    return sql + " ORDER BY account_closed_at, user_account_id"


def cutoff_text(now, grace_days):
    """account_closed_at이 이 시각 이하면 유예가 끝났다(KST 문자열 — DB DATETIME도 KST)."""
    return (now - bc.dt.timedelta(days=grace_days)).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]


def find_targets(jdbc, cutoff, users):
    rows = jdbc.query(targets_sql(users), [cutoff] + list(users))
    # 같은 사용자의 요청이 여럿이면(접수는 한 번이지만 대비) 한 번만 처리하고, 요청 행은 ③에서 모두 지운다
    seen, out = set(), []
    for r in rows:
        uid = int(r["user_account_id"])
        if uid not in seen:
            seen.add(uid)
            out.append({"user_account_id": uid, "requested_at": r["requested_at"][:23],
                        "request_status": r["request_status"]})
    return out


def records_only_count(jdbc):
    rows = jdbc.query("SELECT COUNT(*) AS n FROM deletion_request WHERE request_scope = 'RECORDS_ONLY'"
                      " AND request_status IN ('REQUESTED', 'FAILED', 'PROCESSING')")
    return int(rows[0]["n"]) if rows else 0


# ---------------------------------------------------------------------------
# 사용자 한 명 지우기

ARCHIVE_SQL = ("SELECT fa.feature_archive_id, fa.file_uri, fa.deleted_at FROM feature_archive fa"
               " JOIN monitor_session m ON m.monitor_session_id = fa.monitor_session_id WHERE m.user_account_id = ?")

# 하위부터: 세션이 기준 자세를 막고(FK-27 RESTRICT), 요청이 계정을 막는다(FK-18 RESTRICT)
DELETE_STEPS = (
    ("feature_archive", "DELETE fa FROM feature_archive fa JOIN monitor_session m"
                        " ON m.monitor_session_id = fa.monitor_session_id WHERE m.user_account_id = ?"),
    ("monitor_session", "DELETE FROM monitor_session WHERE user_account_id = ?"),
    ("daily_stat", "DELETE FROM daily_stat WHERE user_account_id = ?"),
    ("baseline_posture", "DELETE FROM baseline_posture WHERE user_account_id = ?"),
    ("deletion_request", "DELETE FROM deletion_request WHERE user_account_id = ?"),
    ("user_account", "DELETE FROM user_account WHERE user_account_id = ? AND account_status = 'CLOSED'"),
)


def hdfs_path(file_uri):
    """feature_archive.file_uri(경로 또는 hdfs://namenode:9000/… 주소) → HDFS 경로(끝 / 없음)."""
    path = urlparse(file_uri).path if file_uri.startswith("hdfs://") else file_uri
    return "/" + path.strip("/")


def delete_files(hdfs, archives, uid):
    """사용자 폴더 + 그 밖에 있는 세션 폴더. 지운 경로 목록(이미 없으면 넣지 않음)."""
    folder = bc.user_folder(uid)
    removed = []
    if hdfs.exists(folder):
        hdfs.delete(folder)
        removed.append(folder)
    for a in archives:
        if a["deleted_at"] is not None:
            continue
        path = hdfs_path(a["file_uri"])
        inside = path.startswith(folder + "/")
        if path in ("/", bc.USER_ROOT) or (path.startswith(bc.USER_ROOT + "/") and not inside):
            # 다른 사용자 폴더·루트는 절대 지우지 않는다(잘못 기록된 위치) — 실패로 남겨 사람이 본다
            raise RuntimeError(f"feature_archive {a['feature_archive_id']} 위치가 이 사용자 폴더 밖")
        if not inside and hdfs.exists(path):
            hdfs.delete(path)
            removed.append(path)
    return removed


def delete_user(jdbc, hdfs, target, now_text):
    """요청 하나 처리. 성공하면 단계별 지운 행 수, 실패하면 예외(호출하는 쪽이 FAILED로)."""
    uid = target["user_account_id"]
    claimed = jdbc.execute("UPDATE deletion_request SET request_status = 'PROCESSING', failure_reason = NULL"
                           " WHERE user_account_id = ? AND request_status IN ('REQUESTED', 'FAILED', 'PROCESSING')",
                           (uid,))
    jdbc.commit()
    if claimed == 0:
        return None  # 그사이 다른 쪽이 처리함

    archives = jdbc.query(ARCHIVE_SQL, (uid,))
    removed = delete_files(hdfs, archives, uid)
    pending = [int(a["feature_archive_id"]) for a in archives if a["deleted_at"] is None]
    if pending:
        jdbc.execute("UPDATE feature_archive SET deleted_at = ? WHERE deleted_at IS NULL AND feature_archive_id IN ("
                     + ",".join("?" for _ in pending) + ")", [now_text] + pending)
    jdbc.commit()  # 파일은 지웠다 — 아래 행 삭제가 실패해도 다음 실행은 deleted_at부터 이어간다

    counts = {}
    for table, sql in DELETE_STEPS:
        counts[table] = jdbc.execute(sql, (uid,))
    if counts["user_account"] != 1:
        raise RuntimeError("계정 행이 없거나 CLOSED가 아님")
    jdbc.commit()
    return {"user_account_id": uid, "files": removed, "rows": counts}


def mark_failed(jdbc, uid, reason):
    jdbc.rollback()
    jdbc.execute("UPDATE deletion_request SET request_status = 'FAILED', failure_reason = ?"
                 " WHERE user_account_id = ? AND request_status = 'PROCESSING'", (reason[:200], uid))
    jdbc.commit()


def notify_done(uid):
    """완료 안내 자리 — 발송 수단 미정(남은 안건). 연락처는 삭제 전에 미리 읽어 두어야 한다(DB README)."""
    bc.log(JOB, f"user {uid} 완료 안내 — 발송 수단 없음(건너뜀)")


def run(jdbc, hdfs, targets, now_text, notify=notify_done):
    done, failed = [], []
    for target in targets:
        uid = target["user_account_id"]
        try:
            result = delete_user(jdbc, hdfs, target, now_text)
        except Exception as error:  # noqa: BLE001 — 사용자 하나의 실패가 다음 사용자를 막지 않게
            reason = f"{type(error).__name__}: {error}".replace("\n", " ")
            try:
                mark_failed(jdbc, uid, reason)
            except Exception as mark_error:  # noqa: BLE001
                bc.log(JOB, f"user {uid} FAILED 기록도 실패: {mark_error}")
            bc.log(JOB, f"user {uid} 실패 — {reason[:200]}")
            failed.append({"user_account_id": uid, "reason": reason[:200]})
            continue
        if result is None:
            continue
        bc.log(JOB, f"user {uid} 삭제 — 파일 {len(result['files'])}개 · 행 {result['rows']}")
        done.append(result)
        notify(uid)
    return done, failed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--user", type=bc.parse_users, default=[], help="이 사용자만 (쉼표로 여러 명, 시험용)")
    parser.add_argument("--dry-run", action="store_true", help="대상만 출력, 지우지 않음")
    parser.add_argument("--grace-days", type=int, default=GRACE_DAYS,
                        help=f"유예 일수(기본 {GRACE_DAYS}). 바꾸려면 --user도 함께(시험용)")
    args = parser.parse_args(argv)
    if args.grace_days != GRACE_DAYS and not args.user:
        parser.error("--grace-days는 --user와 함께만 (운영 대상은 30일 고정)")
    if args.grace_days < 0:
        parser.error("--grace-days는 0 이상")

    db = bc.DbConfig()
    spark = bc.spark_session("posegood-j3-withdrawal-delete")
    try:
        now = bc.dt.datetime.now(bc.KST)
        cutoff = cutoff_text(now, args.grace_days)
        with bc.Jdbc(spark, db) as jdbc:
            targets = find_targets(jdbc, cutoff, args.user)
            skipped = records_only_count(jdbc)
            bc.log(JOB, f"대상 {len(targets)}명 (폐쇄 시각 ≤ {cutoff}, 유예 {args.grace_days}일)"
                        + (f" · RECORDS_ONLY {skipped}건 건너뜀(구현 안 함)" if skipped else ""))
            if args.dry_run:
                print(json.dumps({"cutoff": cutoff, "targets": targets}, ensure_ascii=False), flush=True)
                bc.log(JOB, "DRY-RUN — 지우지 않음")
                return
            hdfs = bc.Hdfs(spark) if targets else None
            done, failed = run(jdbc, hdfs, targets, bc.now_kst_text())
        bc.log(JOB, f"{'OK' if not failed else 'FAIL'} 삭제 {len(done)}명 · 실패 {len(failed)}명")
        print(json.dumps({"cutoff": cutoff, "deleted": [d["user_account_id"] for d in done], "failed": failed},
                         ensure_ascii=False), flush=True)
        if failed:
            sys.exit(1)
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
