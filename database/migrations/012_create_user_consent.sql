-- =====================================================================
-- 012_create_user_consent.sql — 명세서 V2.2 → V2.3 (2/2)
-- T-41 user_consent(사용자 동의)를 만든다. FE 개인정보 수집 동의 제안서(2026-10-13).
--   동의 6종을 동의할 때마다 1행. 계정 최종 삭제 때 함께 지운다(FK-19 CASCADE).
-- 이미 가입한 사용자의 동의 행은 만들지 않는다 — 언제 받을지는 백엔드가 정한다.
-- 되돌리기: DROP TABLE user_consent;
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE user_consent (
  user_account_id BIGINT NOT NULL COMMENT '동의한 사용자. 계정 최종 삭제(탈퇴 30일 뒤) 때 함께 지운다',
  consent_type VARCHAR(20) NOT NULL COMMENT '동의 종류. 이용약관(C1)·회원가입 정보(C2)·선택 정보 나이·직업(C3, 선택)·카메라 관절 좌표(C4)·측정 기록 저장(C5)·만 14세 이상 확인(C6). OPTIONAL_PROFILE 외에는 필수',
  agreed_at DATETIME(3) NOT NULL COMMENT '동의 시각. 동의할 때마다 새 행 — 종류별로 가장 최근 행이 현재 상태',
  document_version VARCHAR(20) NOT NULL COMMENT '동의한 문구 버전 (예: terms-2026-10). 문구 본문은 저장소에서 버전별로 관리. 약관이 바뀌면 새 버전으로 다시 동의받는다',
  withdrawn_at DATETIME(3) NULL COMMENT '철회 시각. NULL: 유효. 선택 정보(OPTIONAL_PROFILE)를 철회하면 user_account의 나이·직업을 비운다. 탈퇴 접수 때는 채우지 않는다',
  CONSTRAINT pk_user_consent PRIMARY KEY (user_account_id, consent_type, agreed_at),
  CONSTRAINT fk_user_consent_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-19
  CONSTRAINT ck_user_consent_consent_type CHECK (consent_type IN ('TERMS', 'ACCOUNT_INFO', 'OPTIONAL_PROFILE', 'POSE_COORDINATES', 'MEASUREMENT_RECORD', 'AGE_14_OVER')),  -- 허용값: TERMS / ACCOUNT_INFO / OPTIONAL_PROFILE / POSE_COORDINATES / MEASUREMENT_RECORD / AGE_14_OVER
  CONSTRAINT ck_user_consent_withdrawn_at CHECK (withdrawn_at >= agreed_at)  -- 허용값: agreed_at 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-41 사용자 동의 — 가입·설정에서 받은 동의를 항목별로 기록';
