-- Service accounts and aggregates only. No images, landmarks, or raw feature requests.
CREATE TABLE users (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    auth_epoch BIGINT NOT NULL DEFAULT 0,
    profile JSON NOT NULL,
    consent_version VARCHAR(64) NOT NULL,
    consented_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB;

CREATE TABLE workspaces (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    rules JSON NOT NULL,
    preferences JSON NOT NULL,
    CONSTRAINT workspace_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE measurement_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    policy JSON NOT NULL,
    snapshot JSON NOT NULL,
    baseline_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    model_version VARCHAR(64),
    end_ms BIGINT,
    started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ended_at TIMESTAMP(6),
    recovery_attempted_at TIMESTAMP(6),
    CONSTRAINT session_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY sessions_owner_started (user_id, started_at)
) ENGINE=InnoDB;

CREATE TABLE input_results (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence BIGINT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    observation JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    rejection_status INT NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, sequence),
    CONSTRAINT input_session FOREIGN KEY (session_id) REFERENCES measurement_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cep_outbox (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence BIGINT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (session_id, sequence),
    CONSTRAINT outbox_input FOREIGN KEY (session_id, sequence) REFERENCES input_results(session_id, sequence) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE session_events (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id BIGINT NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (session_id, event_id),
    CONSTRAINT event_session FOREIGN KEY (session_id) REFERENCES measurement_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE records (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    record_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, record_id),
    CONSTRAINT record_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Immutable acknowledged prefixes permit an honest unconfirmed archive after response loss.
CREATE TABLE confirmed_snapshots (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (session_id, fingerprint),
    CONSTRAINT snapshot_session FOREIGN KEY (session_id) REFERENCES measurement_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Survives account/session deletion until the internal runtime removal is acknowledged.
CREATE TABLE cep_cleanup (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attempted_at TIMESTAMP(6)
) ENGINE=InnoDB;

-- Spring Session JDBC's MySQL schema. Authentication state is server-side and expires.
CREATE TABLE SPRING_SESSION (
    PRIMARY_ID CHAR(36) NOT NULL,
    SESSION_ID CHAR(36) NOT NULL,
    CREATION_TIME BIGINT NOT NULL,
    LAST_ACCESS_TIME BIGINT NOT NULL,
    MAX_INACTIVE_INTERVAL INT NOT NULL,
    EXPIRY_TIME BIGINT NOT NULL,
    PRINCIPAL_NAME VARCHAR(100),
    CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID)
) ENGINE=InnoDB;
CREATE UNIQUE INDEX SPRING_SESSION_IX1 ON SPRING_SESSION (SESSION_ID);
CREATE INDEX SPRING_SESSION_IX2 ON SPRING_SESSION (EXPIRY_TIME);
CREATE INDEX SPRING_SESSION_IX3 ON SPRING_SESSION (PRINCIPAL_NAME);
CREATE TABLE SPRING_SESSION_ATTRIBUTES (
    SESSION_PRIMARY_ID CHAR(36) NOT NULL,
    ATTRIBUTE_NAME VARCHAR(200) NOT NULL,
    ATTRIBUTE_BYTES BLOB NOT NULL,
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID)
        REFERENCES SPRING_SESSION(PRIMARY_ID) ON DELETE CASCADE
) ENGINE=InnoDB;
