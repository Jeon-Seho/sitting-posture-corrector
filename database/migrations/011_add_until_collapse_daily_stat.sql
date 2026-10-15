-- =====================================================================
-- 011_add_until_collapse_daily_stat.sql — 명세서 V2.2 → V2.3 (1/2)
-- daily_stat에 붕괴까지 걸린 시간의 하루 최소·최대를 추가한다.
--   구간: 세션 시작 또는 직전 붕괴 이벤트 종료 → 다음 붕괴 시작(붕괴 없이 끝나면 세션 종료), 겹친 제외 구간은 뺀다.
--   실행 5분(STAT_MIN_SESSION_SEC) 이상 세션만 쓴다. 표본이 없으면 둘 다 NULL.
-- 기존 행은 두 값이 NULL로 채워진다. 값이 필요하면 일별 배치로 그 날짜를 다시 계산한다.
-- 되돌리기: 아래 CHECK 3개와 두 컬럼을 지운다.
--   ALTER TABLE daily_stat DROP CHECK ck_daily_stat_until_collapse, DROP CHECK ck_daily_stat_max_until_collapse_sec,
--     DROP CHECK ck_daily_stat_min_until_collapse_sec, DROP COLUMN max_until_collapse_sec, DROP COLUMN min_until_collapse_sec;
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE daily_stat
  ADD COLUMN min_until_collapse_sec DECIMAL(9,1) NULL COMMENT '바른 자세에서 붕괴까지 걸린 시간의 최솟값(초). 구간 = 세션 시작 또는 직전 붕괴 이벤트 종료 → 다음 붕괴 시작(붕괴 없이 끝나면 세션 종료). 구간과 겹친 제외 구간 시간은 뺀다. 실행 시간(started_at → ended_at)이 5분(STAT_MIN_SESSION_SEC) 이상인 세션만 쓴다. NULL: 그날 표본 없음' AFTER alerted_event_count,
  ADD COLUMN max_until_collapse_sec DECIMAL(9,1) NULL COMMENT '바른 자세에서 붕괴까지 걸린 시간의 최댓값(초). 구간 = 세션 시작 또는 직전 붕괴 이벤트 종료 → 다음 붕괴 시작(붕괴 없이 끝나면 세션 종료). 구간과 겹친 제외 구간 시간은 뺀다. 실행 시간(started_at → ended_at)이 5분(STAT_MIN_SESSION_SEC) 이상인 세션만 쓴다. NULL: 그날 표본 없음' AFTER min_until_collapse_sec,
  ADD CONSTRAINT ck_daily_stat_min_until_collapse_sec CHECK (min_until_collapse_sec >= 0),  -- 허용값: 0 이상
  ADD CONSTRAINT ck_daily_stat_max_until_collapse_sec CHECK (max_until_collapse_sec >= 0),  -- 허용값: 0 이상
  ADD CONSTRAINT ck_daily_stat_until_collapse CHECK ((min_until_collapse_sec IS NULL AND max_until_collapse_sec IS NULL) OR (min_until_collapse_sec IS NOT NULL AND max_until_collapse_sec IS NOT NULL AND min_until_collapse_sec <= max_until_collapse_sec));  -- 최솟값·최댓값은 함께 채워지고 최솟값 ≤ 최댓값
