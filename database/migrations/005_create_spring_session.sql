-- =====================================================================
-- 005_create_spring_session.sql — T-48 SPRING_SESSION, T-49 SPRING_SESSION_ATTRIBUTES (로그인 세션) 추가
-- 근거: CR-03, DB 건의안 0001 #5
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- Spring Session JDBC 표준 정의를 그대로 쓴다. 대문자 이름과 BIGINT(밀리초) 시각은 이름 규칙 예외.
-- 보조 인덱스(EXPIRY_TIME, PRINCIPAL_NAME)는 DB-05 인덱스 파일로 둔다.

-- ---------------------------------------------------------------------
-- T-48 SPRING_SESSION — 로그인 세션 (근거 건의안 0001 #5)
-- ---------------------------------------------------------------------
CREATE TABLE SPRING_SESSION (
  PRIMARY_ID CHAR(36) NOT NULL,
  SESSION_ID CHAR(36) NOT NULL,
  CREATION_TIME BIGINT NOT NULL,
  LAST_ACCESS_TIME BIGINT NOT NULL,
  MAX_INACTIVE_INTERVAL INT NOT NULL,
  EXPIRY_TIME BIGINT NOT NULL,
  PRINCIPAL_NAME VARCHAR(100),
  CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID),
  UNIQUE KEY SPRING_SESSION_IX1 (SESSION_ID)  -- UK-13
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- T-49 SPRING_SESSION_ATTRIBUTES — 로그인 세션 속성 (근거 건의안 0001 #5)
-- ---------------------------------------------------------------------
CREATE TABLE SPRING_SESSION_ATTRIBUTES (
  SESSION_PRIMARY_ID CHAR(36) NOT NULL,
  ATTRIBUTE_NAME VARCHAR(200) NOT NULL,
  ATTRIBUTE_BYTES BLOB NOT NULL,
  CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
  CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID) REFERENCES SPRING_SESSION (PRIMARY_ID) ON DELETE CASCADE  -- FK-25
) ENGINE=InnoDB;
