"""DB 무결성 검사 — 키·CHECK·FK 삭제 동작과 DB-04 삭제 시나리오를 실제로 실행해 확인한다.

대상: 최신 스키마(schema_V2_x.sql)와 시드만 적용한 **빈 DB**. 테스트 계정(test-*@example.invalid)으로 행을 넣고 지우므로
운영·개발 DB에서 실행하지 않는다. 사용자 행이 이미 있으면 시작하지 않는다.

실행 (DB CI가 실행한다):
    pip install pymysql
    MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=root MYSQL_PWD=... DB=posture_service python database/tests/integrity_check.py
하나라도 실패하면 종료 코드 1.
"""
import os, sys, uuid
import pymysql

con = pymysql.connect(host=os.environ.get("MYSQL_HOST", "127.0.0.1"), port=int(os.environ.get("MYSQL_PORT", "3306")),
                      user=os.environ.get("MYSQL_USER", "root"), password=os.environ.get("MYSQL_PWD", ""),
                      database=os.environ.get("DB", "posture_service"), unix_socket=os.environ.get("MYSQL_SOCKET") or None,
                      charset="utf8mb4", autocommit=True)
cur = con.cursor()
cur.execute("SELECT COUNT(*) FROM user_account")
if cur.fetchone()[0]:
    sys.exit("user_account에 행이 있다 — 빈 DB(최신 스키마 + 시드)에서만 실행한다")
results = []


def ok(name, sql, args=None):
    try:
        cur.execute(sql, args); results.append(("PASS", name, "")); return cur
    except Exception as e:
        results.append(("FAIL", name, f"unexpected error: {e}")); return None


def fails(name, sql, args=None, expect=None):
    try:
        cur.execute(sql, args); results.append(("FAIL", name, "succeeded but should fail"))
    except pymysql.err.MySQLError as e:
        code, msg = e.args[0], e.args[1]
        good = expect is None or any(x in msg for x in ([expect] if isinstance(expect, str) else expect))
        results.append(("PASS" if good else "FAIL", name, f"{code} {msg[:90]}"))


def check(name, cond, note=""):
    results.append(("PASS" if cond else "FAIL", name, note))


def one(sql, args=None):
    cur.execute(sql, args); return cur.fetchone()[0]


U = lambda: str(uuid.uuid4())
T0 = "2026-10-02 01:00:00.000"
H = "a" * 64

# ===================================================================== 계정
pol = one("SELECT threshold_policy_id FROM threshold_policy WHERE policy_name='DEFAULT_TEMP'")
ins_user = "INSERT INTO user_account (login_email,password_hash,display_name,joined_at,threshold_policy_id) VALUES (%s,'x','테스트',%s,%s)"
ok("가입 — 기본 정책을 이름으로 찾아 연결", ins_user, ("test-a@example.invalid", T0, pol)); A = cur.lastrowid
ok("가입 — 두 번째 테스트 사용자", ins_user, ("test-b@example.invalid", T0, pol)); B = cur.lastrowid
fails("UK-01 같은 이메일 재가입 (대소문자만 다름)", ins_user, ("TEST-A@example.invalid", T0, pol), "ux_user_account_login_email")
for col in ("login_email", "password_hash", "display_name"):
    fails(f"CR-04 식별 컬럼 필수 — {col} NULL 거부", f"UPDATE user_account SET {col}=NULL WHERE user_account_id=%s", (A,), "cannot be null")
ok("auth_epoch 기본값 0", "SELECT 1 FROM user_account WHERE user_account_id=%s AND auth_epoch=0", (A,))
fails("auth_epoch 음수 거부", "UPDATE user_account SET auth_epoch=-1 WHERE user_account_id=%s", (A,), "ck_user_account_auth_epoch")
ok("나이·직업 입력 (선택)", "UPDATE user_account SET age=30, occupation='개발자' WHERE user_account_id=%s", (A,))
fails("나이 0 거부", "UPDATE user_account SET age=0 WHERE user_account_id=%s", (A,), "ck_user_account_age")
fails("나이 121 거부", "UPDATE user_account SET age=121 WHERE user_account_id=%s", (A,), "ck_user_account_age")

# ===================================================================== 기준 자세·세션
ins_base = ("INSERT INTO baseline_posture (user_account_id,calibration_uuid,feature_version,calibration_sec,sample_count,"
            "target_center_x,target_center_y,target_area_ratio,registered_at,deactivated_at) VALUES (%s,%s,'FEAT-PROTO-1',5.0,20,0.5,0.5,0.3,%s,%s)")
ok("기준 자세 등록 A", ins_base, (A, U(), T0, None)); BA1 = cur.lastrowid
fails("UK-11 활성 기준 자세 두 개", ins_base, (A, U(), T0, None), "ux_baseline_posture_active")
ok("기준 자세 등록 B", ins_base, (B, U(), T0, None)); BB = cur.lastrowid
ok("기준 특징값", "INSERT INTO baseline_feature VALUES (%s,'HEAD_GAP',0.123456,0.01),(%s,'SHOULDER_TILT',0.02,NULL)", (BA1, BA1))
fails("FK-06 없는 특징값 코드", "INSERT INTO baseline_feature VALUES (%s,'NO_SUCH',0.1,NULL)", (BA1,), "fk_baseline_feature_feature_def")

ins_ses = ("INSERT INTO monitor_session (client_session_uuid,user_account_id,baseline_posture_id,threshold_policy_id,"
           "frame_width,frame_height,started_at) VALUES (%s,%s,%s,%s,1280,720,%s)")
fails("D-35 다른 사용자의 기준 자세로 세션", ins_ses, (U(), A, BB, pol, T0), "fk_monitor_session_baseline_posture")
cu = U()
ok("세션 시작 A", ins_ses, (cu, A, BA1, pol, T0)); SA = cur.lastrowid
fails("UK-05 같은 클라이언트 세션 식별자 재전송", ins_ses, (cu, A, BA1, pol, T0), "ux_monitor_session_client_uuid")
fails("UUID 길이가 아닌 세션 식별자", ins_ses, ("short", A, BA1, pol, T0), "ck_monitor_session_client_session_uuid")
fails("종료 시각만 있고 종료 사유 없음", "UPDATE monitor_session SET ended_at='2026-10-02 02:00:00' WHERE monitor_session_id=%s", (SA,), "ck_monitor_session_end")
ok("세션 종료 (세 값 함께)", "UPDATE monitor_session SET ended_at='2026-10-02 02:00:00', end_reason='USER_STOP', good_sec=3000.0 WHERE monitor_session_id=%s", (SA,))

# 기준 자세 원자적 교체 (D-27): 한 트랜잭션에서 비활성 전환 + 새 기준
con.begin()
cur.execute("UPDATE baseline_posture SET deactivated_at='2026-10-02 03:00:00' WHERE baseline_posture_id=%s", (BA1,))
cur.execute(ins_base, (A, U(), "2026-10-02 03:00:00", None)); BA2 = cur.lastrowid
con.commit(); check("D-27 기준 자세 교체 (비활성 전환 + 새 기준, 한 트랜잭션)", True)

# ===================================================================== 세션 하위 기록
ok("제외 구간 PAUSE", "INSERT INTO excluded_interval VALUES (%s,'2026-10-02 01:10:00','2026-10-02 01:11:00','PAUSE')", (SA,))
ok("제외 구간 MISSING (입력 누락)", "INSERT INTO excluded_interval VALUES (%s,'2026-10-02 01:12:00',NULL,'MISSING')", (SA,))
fails("없는 제외 사유 거부", "INSERT INTO excluded_interval VALUES (%s,'2026-10-02 01:13:00',NULL,'OTHER')", (SA,), "ck_excluded_interval_exclusion_reason")
fails("제외 구간 종료가 시작보다 앞섬", "INSERT INTO excluded_interval VALUES (%s,'2026-10-02 01:20:00','2026-10-02 01:19:00','ABSENCE')", (SA,), "ck_excluded_interval_ended_at")
ok("붕괴 이벤트 (회복 종료)", "INSERT INTO collapse_event VALUES (%s,1,'2026-10-02 01:30:00','2026-10-02 01:30:03','2026-10-02 01:31:00','RECOVERED','2026-10-02 01:31:00')", (SA,))
fails("BR-12 회복이 아닌데 회복 시각", "INSERT INTO collapse_event VALUES (%s,2,'2026-10-02 01:40:00','2026-10-02 01:40:03','2026-10-02 01:41:00','SESSION_END','2026-10-02 01:41:00')", (SA,), "ck_collapse_event_recovered")
ok("교정 알림 (표시됨)", "INSERT INTO correction_alert (monitor_session_id,event_seq,attempt_seq,attempted_at,delivered,suppress_reason) VALUES (%s,1,1,'2026-10-02 01:30:03',TRUE,NULL)", (SA,))
ok("교정 알림 (억제됨)", "INSERT INTO correction_alert (monitor_session_id,event_seq,attempt_seq,attempted_at,delivered,suppress_reason) VALUES (%s,1,2,'2026-10-02 01:31:03',FALSE,'RATE_LIMIT')", (SA,))
fails("BR-14 억제됐는데 사유 없음", "INSERT INTO correction_alert (monitor_session_id,event_seq,attempt_seq,attempted_at,delivered,suppress_reason) VALUES (%s,1,3,'2026-10-02 01:32:03',FALSE,NULL)", (SA,), "ck_correction_alert_suppress")
ok("특징값 적재 기록", "INSERT INTO feature_archive (monitor_session_id,file_uri,range_start_at,range_end_at,row_count,archived_at) VALUES (%s,'hdfs:///features/dt=2026-10-02/s=1.parquet','2026-10-02 01:00:00','2026-10-02 02:00:00',36000,'2026-10-02 04:00:00')", (SA,))
ok("일별 통계", "INSERT INTO daily_stat VALUES (%s,'2026-10-02',3540.0,3000.0,1,1,1,'2026-10-03 00:10:00')", (A,))
fails("BR-17 분자가 분모보다 큼", "INSERT INTO daily_stat VALUES (%s,'2026-10-01',10.0,20.0,1,0,0,'2026-10-03 00:10:00')", (A,), "ck_daily_stat_subset")
ok("앱 기록 원문 저장", "INSERT INTO client_record VALUES (%s,'rec-1',%s,'{\"summary\":{}}',%s)", (A, H, T0))
fails("같은 앱 기록 식별자 거부", "INSERT INTO client_record VALUES (%s,'rec-1',%s,'{}',%s)", (A, H, T0), "PRIMARY")

# ===================================================================== 삭제 차단 (DB-04)
fails("D-38 적재 기록이 남은 세션 삭제 (FK-13)", "DELETE FROM monitor_session WHERE monitor_session_id=%s", (SA,), "fk_feature_archive_monitor_session")
fails("D-37 세션이 남은 사용자 삭제 (FK-07)", "DELETE FROM user_account WHERE user_account_id=%s", (A,), ["fk_monitor_session", "foreign key constraint fails"])
fails("6-5 사용 중인 판정 정책 삭제", "DELETE FROM threshold_policy WHERE threshold_policy_id=%s", (pol,), "foreign key constraint fails")
fails("6-5 기준 자세가 쓰는 특징값 삭제", "DELETE FROM feature_def WHERE feature_code='HEAD_GAP'", None, "fk_baseline_feature_feature_def")
fails("BR-65·D-36 정책 PK 변경", "UPDATE threshold_policy SET threshold_policy_id=999 WHERE threshold_policy_id=%s", (pol,), "foreign key constraint fails")
fails("0.5 단위 위반", "INSERT INTO threshold_policy (threshold,hold_seconds,recover_seconds,realert_seconds,notify_max_per_hour,created_by,created_at) VALUES (0.6,3.3,2.0,30,12,'USER','2026-10-02 00:00:00')", None, "ck_threshold_policy_hold_seconds")
fails("D-39 기록 삭제 요청에 폐쇄 시각", "INSERT INTO deletion_request VALUES (%s,'2026-10-02 05:00:00','RECORDS_ONLY','REQUESTED','2026-10-02 05:00:00',NULL,NULL)", (A,), "ck_deletion_request_scope")
fails("BR-66 삭제 완료 시각 없이 DONE", "INSERT INTO deletion_request VALUES (%s,'2026-10-02 05:00:00','ACCOUNT_ALL','DONE','2026-10-02 05:00:00',NULL,NULL)", (A,), "ck_deletion_request_done")

# ===================================================================== 시나리오 1: 계정 탈퇴 — 30일 유예 후 삭제 (DB-04 V0.2 6-1)
GRACE = 30                                    # WITHDRAWAL_GRACE_DAY
REF = "2026-10-08 00:00:00"                   # 배치 실행 시각 (고정값으로 둔다)
due_sql = ("SELECT user_account_id FROM deletion_request WHERE request_scope='ACCOUNT_ALL' AND request_status IN ('REQUESTED','FAILED') "
           "AND account_closed_at <= %s - INTERVAL %s DAY ORDER BY user_account_id")


def intake(uid, at):
    con.begin()
    cur.execute("INSERT INTO deletion_request (user_account_id,requested_at,request_scope,account_closed_at) VALUES (%s,%s,'ACCOUNT_ALL',%s)", (uid, at, at))
    cur.execute("UPDATE user_account SET account_status='CLOSED', auth_epoch=auth_epoch+1 WHERE user_account_id=%s", (uid,))
    con.commit()


intake(A, "2026-09-05 09:00:00"); check("S1-0 접수 — 삭제 요청 REQUESTED + 계정 CLOSED (한 트랜잭션)",
      one("SELECT account_status FROM user_account WHERE user_account_id=%s", (A,)) == "CLOSED")
check("S1-1 유예 중 — 식별 정보·측정 기록은 그대로",
      one("SELECT COUNT(*) FROM user_account WHERE user_account_id=%s AND login_email IS NOT NULL", (A,)) == 1
      and one("SELECT COUNT(*) FROM monitor_session WHERE user_account_id=%s", (A,)) == 1)
fails("S1-1 유예 중 같은 이메일로 재가입 거부 (UK-01)", ins_user, ("test-a@example.invalid", T0, pol), "ux_user_account_login_email")

# 6-1-1 철회: REQUESTED일 때만. 요청 행을 잠그고 상태 확인 → 계정 ACTIVE + 요청 행 삭제
con.begin()
cur.execute("SELECT request_status FROM deletion_request WHERE user_account_id=%s AND request_scope='ACCOUNT_ALL' FOR UPDATE", (A,))
st = cur.fetchone()[0]
cur.execute("UPDATE user_account SET account_status='ACTIVE' WHERE user_account_id=%s", (A,))
cur.execute("DELETE FROM deletion_request WHERE user_account_id=%s AND request_scope='ACCOUNT_ALL' AND request_status='REQUESTED'", (A,))
con.commit()
check("S1-1-1 철회 — 계정 ACTIVE, 요청 행 없음, 기록 그대로",
      st == "REQUESTED" and one("SELECT account_status FROM user_account WHERE user_account_id=%s", (A,)) == "ACTIVE"
      and one("SELECT COUNT(*) FROM deletion_request WHERE user_account_id=%s", (A,)) == 0
      and one("SELECT COUNT(*) FROM monitor_session WHERE user_account_id=%s", (A,)) == 1)

# 다시 탈퇴. B는 유예 기간이 남은 상태로 둔다
intake(A, "2026-09-07 09:00:00")
intake(B, "2026-10-01 09:00:00")
cur.execute(due_sql, (REF, GRACE)); due = [r[0] for r in cur.fetchall()]
check("S1-2 유예 종료 대상 — 폐쇄 시각 + 30일이 지난 요청만 (삭제 예정일 컬럼 없이 계산)", due == [A], f"due={due}")

ok("S1-2 PROCESSING", "UPDATE deletion_request SET request_status='PROCESSING' WHERE user_account_id=%s AND request_scope='ACCOUNT_ALL'", (A,))
ok("S1-2 HDFS 파일 삭제 후 deleted_at 기록", "UPDATE feature_archive fa JOIN monitor_session s USING (monitor_session_id) SET fa.deleted_at='2026-10-08 00:05:00' WHERE s.user_account_id=%s", (A,))

contact = None
try:
    con.begin()
    cur.execute("SELECT login_email FROM user_account WHERE user_account_id=%s", (A,)); contact = cur.fetchone()[0]   # 4단계 안내용
    left = one("SELECT COUNT(*) FROM feature_archive fa JOIN monitor_session s USING (monitor_session_id) WHERE s.user_account_id=%s AND fa.deleted_at IS NULL", (A,))
    assert left == 0, "파일이 남은 적재 기록"
    cur.execute("DELETE fa FROM feature_archive fa JOIN monitor_session s USING (monitor_session_id) WHERE s.user_account_id=%s", (A,))   # 3-1
    cur.execute("DELETE FROM monitor_session WHERE user_account_id=%s", (A,))                                                           # 3-2
    cur.execute("DELETE FROM daily_stat WHERE user_account_id=%s", (A,))                                                                # 3-3
    cur.execute("DELETE FROM baseline_posture WHERE user_account_id=%s", (A,))                                                          # 3-4
    cur.execute("DELETE FROM deletion_request WHERE user_account_id=%s", (A,))                                                          # 3-6
    cur.execute("DELETE FROM user_account WHERE user_account_id=%s", (A,))                                                              # 3-7
    con.commit(); check("S1-3 최종 삭제 한 트랜잭션 (3-1~3-7)", True)
except Exception as e:
    con.rollback(); check("S1-3 최종 삭제 한 트랜잭션 (3-1~3-7)", False, str(e))
check("S1-4 완료 안내용 연락처를 삭제 전에 읽음", contact == "test-a@example.invalid")
cnt = {t: one(f"SELECT COUNT(*) FROM {t}") for t in ("excluded_interval", "collapse_event", "correction_alert", "baseline_feature", "client_record")}
check("S1 연쇄 삭제 — 제외 구간·이벤트·알림·기준 특징값·앱 기록 원문 0행", all(v == 0 for v in cnt.values()), str(cnt))
check("S1 계정 행과 삭제 요청 행이 남지 않음",
      one("SELECT COUNT(*) FROM user_account WHERE user_account_id=%s", (A,)) == 0 and one("SELECT COUNT(*) FROM deletion_request WHERE user_account_id=%s", (A,)) == 0)
check("S1 공유 판정 정책은 남음", one("SELECT COUNT(*) FROM threshold_policy") == 1)
check("S1 유예 중인 다른 계정(B)은 그대로", one("SELECT account_status FROM user_account WHERE user_account_id=%s", (B,)) == "CLOSED")
ok("S1 최종 삭제 후 같은 이메일로 재가입", ins_user, ("test-a@example.invalid", T0, pol)); A2 = cur.lastrowid

# 실패하면 전부 되돌린다 (6-0 #3) — 파일 삭제 표시 없이 행 삭제를 시도
ok("S1-실패 준비: B 세션·적재 기록", ins_ses, (U(), B, BB, pol, T0)); SB = cur.lastrowid
cur.execute("INSERT INTO feature_archive (monitor_session_id,file_uri,range_start_at,range_end_at,row_count,archived_at) VALUES (%s,'hdfs:///features/dt=2026-10-02/s=2.parquet',%s,%s,10,%s)", (SB, T0, T0, T0))
try:
    con.begin()
    cur.execute("DELETE FROM monitor_session WHERE user_account_id=%s", (B,))
    con.commit(); check("S1-실패 적재 기록이 남으면 세션 삭제가 막힘 (FK-13)", False, "succeeded")
except pymysql.err.MySQLError as e:
    con.rollback(); check("S1-실패 적재 기록이 남으면 세션 삭제가 막힘 (FK-13)", "fk_feature_archive_monitor_session" in e.args[1])
ok("S1-실패 요청을 FAILED + 사유로 둠", "UPDATE deletion_request SET request_status='FAILED', failure_reason='feature_archive 남음' WHERE user_account_id=%s", (B,))
check("S1-실패 되돌린 뒤 B의 계정·세션·요청 행이 그대로",
      one("SELECT COUNT(*) FROM monitor_session WHERE user_account_id=%s", (B,)) == 1 and one("SELECT COUNT(*) FROM deletion_request WHERE user_account_id=%s", (B,)) == 1)
# 재시도는 같은 요청으로 이어서 한다 (6-0 #4). 3-6(요청 행 삭제)을 건너뛰면 FK-18이 계정 삭제를 막는다
ok("S1-재시도 파일 삭제 후 deleted_at 기록", "UPDATE feature_archive SET deleted_at='2026-10-08 00:10:00' WHERE monitor_session_id=%s", (SB,))
try:
    con.begin()
    cur.execute("DELETE FROM feature_archive WHERE monitor_session_id=%s", (SB,))
    cur.execute("DELETE FROM monitor_session WHERE user_account_id=%s", (B,))
    cur.execute("DELETE FROM baseline_posture WHERE user_account_id=%s", (B,))
    cur.execute("DELETE FROM user_account WHERE user_account_id=%s", (B,))
    con.commit(); check("S1-재시도 요청 행을 남긴 채 계정 삭제하면 막힘 (FK-18)", False, "succeeded")
except pymysql.err.MySQLError as e:
    con.rollback(); check("S1-재시도 요청 행을 남긴 채 계정 삭제하면 막힘 (FK-18)", "fk_deletion_request_user_account" in e.args[1], f"{e.args[0]} {e.args[1][:90]}")

# ===================================================================== 시나리오 2: 세션만 삭제, 통계 보존 (6-2)
ok("S2 준비: A2 기준 자세·세션·통계", ins_base, (A2, U(), T0, None)); BA3 = cur.lastrowid
ok("S2 준비: A2 세션", ins_ses, (U(), A2, BA3, pol, T0)); SA2 = cur.lastrowid
ok("S2 준비: A2 통계", "INSERT INTO daily_stat VALUES (%s,'2026-10-02',100.0,50.0,1,0,0,'2026-10-03 00:10:00')", (A2,))
ok("S2 세션 삭제", "DELETE FROM monitor_session WHERE monitor_session_id=%s", (SA2,))
check("S2 일별 통계는 세션 삭제의 영향을 받지 않음", one("SELECT COUNT(*) FROM daily_stat WHERE user_account_id=%s", (A2,)) == 1)

# ===================================================================== 세션 없는 계정 삭제 — FK-04·17·26 CASCADE, UK-11 함수 기반 키와 공존
ok("CASCADE 준비: A2 앱 기록 원문", "INSERT INTO client_record VALUES (%s,'rec-2',%s,'{}',%s)", (A2, H, T0))
ok("세션 없는 계정 삭제 → 기준 자세·통계·앱 기록 원문 연쇄", "DELETE FROM user_account WHERE user_account_id=%s", (A2,))
left = {t: one(f"SELECT COUNT(*) FROM {t} WHERE user_account_id=%s", (A2,)) for t in ("baseline_posture", "daily_stat", "client_record")}
check("CASCADE 결과 0행", all(v == 0 for v in left.values()), str(left))

# ===================================================================== 로그인 세션 (Spring Session 표준 정의)
ok("로그인 세션 저장", "INSERT INTO SPRING_SESSION VALUES (%s,%s,1,1,1800,2,'test-b@example.invalid')", ("p" * 36, "x" * 36))
ok("로그인 세션 속성 저장", "INSERT INTO SPRING_SESSION_ATTRIBUTES VALUES (%s,'SPRING_SECURITY_CONTEXT',X'00')", ("p" * 36,))
fails("같은 SESSION_ID 거부", "INSERT INTO SPRING_SESSION VALUES (%s,%s,1,1,1800,2,NULL)", ("q" * 36, "x" * 36), "SPRING_SESSION_IX1")
ok("만료 세션 삭제", "DELETE FROM SPRING_SESSION WHERE EXPIRY_TIME < 3")
check("로그인 세션 삭제 시 속성 연쇄 삭제", one("SELECT COUNT(*) FROM SPRING_SESSION_ATTRIBUTES") == 0)

# ===================================================================== 정리 — 테스트 행 삭제 (6-1 순서)
cur.execute("DELETE FROM feature_archive"); cur.execute("DELETE FROM monitor_session")
cur.execute("DELETE FROM baseline_posture"); cur.execute("DELETE FROM deletion_request"); cur.execute("DELETE FROM user_account")

for st, name, note in results:
    print(f"{st}  {name}{'  · ' + note if note else ''}")
failed = [r for r in results if r[0] != "PASS"]
print(f"\n{len(results) - len(failed)} / {len(results)} PASS")
sys.exit(1 if failed else 0)
