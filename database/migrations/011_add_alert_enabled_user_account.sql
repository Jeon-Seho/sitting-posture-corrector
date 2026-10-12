-- =====================================================================
-- 011_add_alert_enabled_user_account.sql — 명세서 V2.1 → V2.2
-- 대상: schema_V2_1.sql로 만든 DB. 새 DB는 schema_V2_2.sql로 만들고 이 파일을 적용하지 않는다.
--
-- 1) user_account.alert_enabled 추가 — 설정 화면 「자세 알림」(교정 알림 전체 켜기·끄기). 기본 켜짐.
--    기존 행은 모두 TRUE가 된다.
-- 2) user_account.sound_alert_enabled 설명 변경 — 측정 화면의 소리 켜기·끄기만 뜻한다. 타입·기본값은 그대로.
--
-- 기존 값 옮기기는 하지 않는다. V1.1 백엔드는 「자세 알림」 값을 sound_alert_enabled에 넣었지만,
--   V1.1 DB는 V2.1로 올리지 않고 다시 만들었으므로 V2.1 DB에는 그렇게 쓰인 값이 없다.
-- 되돌리기: ALTER TABLE user_account DROP COLUMN alert_enabled; 후 sound_alert_enabled 설명을 V2.1 문구로 되돌린다.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE user_account
  ADD COLUMN alert_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '교정 알림(자세 알림) 사용. 끄면 화면 알림과 소리를 모두 표시하지 않고 이벤트 기록은 유지. 측정 시작 때 monitor_session.alert_enabled로 복사'
    AFTER threshold_policy_id,
  MODIFY COLUMN sound_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소리 알림 사용. 켜면 교정 알림이 표시될 때 소리도 냄. 측정 시작 버튼을 누를 때 켬';
