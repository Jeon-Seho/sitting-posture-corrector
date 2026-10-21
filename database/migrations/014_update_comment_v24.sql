-- =====================================================================
-- 014_update_comment_v24.sql — 명세서 V2.3 → V2.4 (2/2)
-- 컬럼·테이블 설명만 바꾼다(「DB-V2.4-변경사항」 4.1·4.3·4.4절). 타입·NULL·기본값·CHECK·데이터는 그대로다.
--   user_account: 탈퇴 철회 없음(결정 1), 알림 컬럼 설명(ADR 0022)
--   monitor_session·daily_stat: 0.1초 아래 버림을 세션(표본)마다(결정 9), daily_stat은 Spark J2만 쓴다
--   deletion_request: 상태는 Spark J3만 바꾼다
-- MODIFY는 타입·NULL·기본값을 schema_V2_4.sql과 똑같이 다시 적는다(다르면 DB CI 비교에서 잡힌다).
-- 되돌리기: 같은 MODIFY를 schema_V2_3.sql의 설명으로 다시 실행한다(설명만 바뀌므로 데이터 영향 없음).
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE user_account
  MODIFY account_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' COMMENT '계정 상태. 탈퇴 요청 접수 시 CLOSED. 철회 없음 — CLOSED는 ACTIVE로 되돌아오지 않고, 유예 기간(30일) 뒤 Spark J3가 계정 행을 지운다',
  MODIFY sound_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '알림 켜기·끄기 (API preferences.alerts_on). 측정 시작 때 monitor_session.alert_enabled로 복사한다. 기본값(DB 거짓 / FE 켜짐)과 컬럼 이름 변경 여부는 미정';

ALTER TABLE monitor_session
  MODIFY good_sec DECIMAL(9,1) NULL COMMENT '바른 자세로 판정된 시간 (원자료, D-22). 밀리초 값의 0.1초 아래는 버린다(15,250ms → 15.2). NULL: 측정 중';

ALTER TABLE daily_stat
  MODIFY valid_sec DECIMAL(9,1) NOT NULL COMMENT '유효 측정 시간 합 (분모). 세션마다 0.1초 아래를 버린 값을 더한다. 합계는 다시 버리지 않는다',
  MODIFY good_sec DECIMAL(9,1) NOT NULL COMMENT '바른 자세 시간 합 (분자). 세션 good_sec(이미 버린 값)을 더한다. 합계는 다시 버리지 않는다',
  MODIFY min_until_collapse_sec DECIMAL(9,1) NULL COMMENT '바른 자세에서 붕괴까지 걸린 시간의 최솟값(초). 구간 = 세션 시작 또는 직전 붕괴 이벤트 종료 → 다음 붕괴 시작(붕괴 없이 끝나면 세션 종료). 구간과 겹친 제외 구간 시간은 뺀다. 실행 시간(started_at → ended_at)이 5분(STAT_MIN_SESSION_SEC) 이상인 세션만 쓴다. NULL: 그날 표본 없음. 표본마다 0.1초 아래를 버린다',
  MODIFY max_until_collapse_sec DECIMAL(9,1) NULL COMMENT '바른 자세에서 붕괴까지 걸린 시간의 최댓값(초). 구간 = 세션 시작 또는 직전 붕괴 이벤트 종료 → 다음 붕괴 시작(붕괴 없이 끝나면 세션 종료). 구간과 겹친 제외 구간 시간은 뺀다. 실행 시간(started_at → ended_at)이 5분(STAT_MIN_SESSION_SEC) 이상인 세션만 쓴다. NULL: 그날 표본 없음. 표본마다 0.1초 아래를 버린다',
  MODIFY computed_at DATETIME(3) NOT NULL COMMENT '집계 시각 (재계산 추적). Spark J2가 쓴다',
  COMMENT = 'T-39 일별 통계 — 사용자·일자별 분자·분모 집계 (마트). Spark J2(매일 00:00, 전날 KST)만 쓰고 입출구 서버는 읽기만 한다';

ALTER TABLE deletion_request
  MODIFY request_status VARCHAR(12) NOT NULL DEFAULT 'REQUESTED' COMMENT '처리 상태. DONE은 실제 삭제 완료 후에만. 입출구 서버는 REQUESTED만 넣고 상태는 Spark J3만 바꾼다';
