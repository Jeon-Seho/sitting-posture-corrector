"""통합 테스트 16·17단계(J3·J1) 준비·확인 도구 — 시험 계정(test-*@example.invalid)만 다룬다 (D-49·D-33).

pytest가 모으지 않는 이름. integration_test.sh가 spark 컨테이너에 복사해 spark-submit으로 돌린다
(잡 공통 모듈은 /opt/jobs/batch_common.py). 운영 잡 폴더(bigdata/jobs)에는 두지 않는다.

  prepare --user ID --closed-days N [--session UUID]
      시험 계정을 CLOSED로, 삭제 요청(ACCOUNT_ALL·REQUESTED, 접수·폐쇄 시각 = 지금 − N일)을 넣는다.
      --session이 있으면 그 세션의 HDFS 세션 폴더(/data/users/{ID}/{시작일}/{UUID}/, 작은 파일 1개)와 feature_archive 1행.
  status --user ID[,ID]
      사용자별 남은 행 수·요청 상태·HDFS 사용자 폴더 유무를 JSON 한 줄로.
  archive-info --session UUID
      그 세션의 feature_archive 행(file_uri·구간 시각)과 HDFS 세션 폴더 파일별 줄 수·종류별 개수를 JSON 한 줄로(J1 확인).
"""

import argparse
import json
import sys

sys.path.insert(0, "/opt/jobs")
import batch_common as bc  # noqa: E402

TEST_EMAIL = "login_email LIKE 'test-%' AND login_email LIKE '%@example.invalid'"
COUNTS = {
    "user_account": "SELECT COUNT(*) AS n FROM user_account WHERE user_account_id = ?",
    "monitor_session": "SELECT COUNT(*) AS n FROM monitor_session WHERE user_account_id = ?",
    "daily_stat": "SELECT COUNT(*) AS n FROM daily_stat WHERE user_account_id = ?",
    "baseline_posture": "SELECT COUNT(*) AS n FROM baseline_posture WHERE user_account_id = ?",
    "feature_archive": ("SELECT COUNT(*) AS n FROM feature_archive fa JOIN monitor_session m"
                        " ON m.monitor_session_id = fa.monitor_session_id WHERE m.user_account_id = ?"),
    "deletion_request": "SELECT COUNT(*) AS n FROM deletion_request WHERE user_account_id = ?",
}


def prepare(spark, jdbc, uid, closed_days, session):
    if not jdbc.query(f"SELECT 1 AS x FROM user_account WHERE user_account_id = ? AND {TEST_EMAIL}", (uid,)):
        raise SystemExit(f"user {uid}는 시험 계정이 아님 — 건드리지 않음")
    when = (bc.dt.datetime.now(bc.KST) - bc.dt.timedelta(days=closed_days)).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]
    jdbc.execute("UPDATE user_account SET account_status = 'CLOSED' WHERE user_account_id = ?", (uid,))
    jdbc.execute("INSERT INTO deletion_request (user_account_id, requested_at, request_scope, request_status,"
                 " account_closed_at) VALUES (?, ?, 'ACCOUNT_ALL', 'REQUESTED', ?)", (uid, when, when))
    folder = None
    if session:
        rows = jdbc.query("SELECT monitor_session_id, DATE_FORMAT(started_at, '%Y-%m-%d') AS d,"
                          " DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s.%f') AS s,"
                          " DATE_FORMAT(COALESCE(ended_at, started_at), '%Y-%m-%d %H:%i:%s.%f') AS e"
                          " FROM monitor_session WHERE client_session_uuid = ? AND user_account_id = ?", (session, uid))
        if not rows:
            raise SystemExit(f"세션 {session}이 user {uid}의 것이 아님")
        r = rows[0]
        folder = f"{bc.user_folder(uid)}/{r['d']}/{session}/"
        bc.Hdfs(spark).write_text(folder + "_j3_test.txt", "integration test J3\n")
        jdbc.execute("INSERT INTO feature_archive (monitor_session_id, file_uri, range_start_at, range_end_at,"
                     " archived_at) VALUES (?, ?, ?, ?, ?)",
                     (int(r["monitor_session_id"]), folder, r["s"][:23], r["e"][:23], bc.now_kst_text()))
    print(json.dumps({"user_account_id": uid, "closed_at": when, "folder": folder}), flush=True)


def status(spark, jdbc, users):
    hdfs = bc.Hdfs(spark)
    out = []
    for uid in users:
        row = {"user_account_id": uid}
        for name, sql in COUNTS.items():
            row[name] = int(jdbc.query(sql, (uid,))[0]["n"])
        req = jdbc.query("SELECT request_status FROM deletion_request WHERE user_account_id = ?", (uid,))
        row["request_status"] = req[0]["request_status"] if req else None
        row["hdfs_user_folder"] = hdfs.exists(bc.user_folder(uid))
        out.append(row)
    print(json.dumps(out), flush=True)


def archive_info(spark, jdbc, session):
    rows = jdbc.query("SELECT fa.file_uri, DATE_FORMAT(fa.range_start_at, '%Y-%m-%d %H:%i:%s.%f') AS range_start_at,"
                      " DATE_FORMAT(fa.range_end_at, '%Y-%m-%d %H:%i:%s.%f') AS range_end_at,"
                      " DATE_FORMAT(m.started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at, m.user_account_id"
                      " FROM feature_archive fa JOIN monitor_session m ON m.monitor_session_id = fa.monitor_session_id"
                      " WHERE m.client_session_uuid = ?", (session,))
    out = {"session": session, "rows": len(rows)}
    if rows:
        r = rows[0]
        out.update({k: (r[k][:23] if k.endswith("_at") else r[k]) for k in r})
        hdfs = bc.Hdfs(spark)
        files = {}
        for name in ("features.jsonl", "inference.jsonl", "episodes.jsonl", "keypoints.jsonl"):  # keypoints: D-92
            path = r["file_uri"] + name
            if not hdfs.exists(path):
                files[name] = None
                continue
            kinds = {}
            for line in hdfs.read_text(path).splitlines():
                kind = json.loads(line).get("kind")
                kinds[kind] = kinds.get(kind, 0) + 1
            files[name] = kinds
        out["files"] = files
    print(json.dumps(out), flush=True)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--user", type=int, required=True)
    p.add_argument("--closed-days", type=int, required=True)
    p.add_argument("--session")
    s = sub.add_parser("status")
    s.add_argument("--user", type=bc.parse_users, required=True)
    a = sub.add_parser("archive-info")
    a.add_argument("--session", required=True)
    args = parser.parse_args()
    db = bc.DbConfig()
    spark = bc.spark_session("posegood-batch-testkit")
    try:
        with bc.Jdbc(spark, db) as jdbc:
            if args.cmd == "prepare":
                prepare(spark, jdbc, args.user, args.closed_days, args.session)
            elif args.cmd == "archive-info":
                archive_info(spark, jdbc, args.session)
            else:
                status(spark, jdbc, args.user)
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
