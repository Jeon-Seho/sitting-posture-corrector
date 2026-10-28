package com.posture.api.report;

import com.posture.api.posture.store.DefaultPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * (D-30, D-51, D-65) 시험용 계정·기준 자세·세션 행(DB V2.6) — 입출구 서버를 거치지 않고 저장 경로를 서버에서 시험하려고 둔다.
 *
 * <p>DB 회신 DB-6: 시험 계정 {@code test-*@example.invalid}, 비밀번호 해시는 가짜 값, 합성 데이터만.
 * V2.3은 세션이 기준 자세를 참조하므로(FK-27) 기준 자세 행(합성 좌표 18개)도 만든다.
 * 기본 정책 행은 값 4개로 찾고, 없으면 입출구 서버와 같은 방식으로 같은 값의 행을 넣는다(정책 행은 지우지 않음).
 * 지울 때는 세션(하위 이벤트·알림·제외 구간은 FK CASCADE) → 계정(기준 자세·동의는 CASCADE) 순.
 * {@code report.test-fixtures.enabled=false}(기본)면 컨트롤러가 막는다.
 */
@Component
public class JdbcReportTestFixtures {

    static final String EMAIL_SUFFIX = "@example.invalid";
    private static final Pattern SCHEMA_NAME = Pattern.compile("[A-Za-z0-9_]{1,64}");
    /** 관절 9개 × x·y — 합성 좌표(정규화 0~1). */
    private static final String[] JOINTS = {"nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left",
            "mouth_right", "left_shoulder", "right_shoulder"};
    private static final double[][] COORDS = {{0.5, 0.4}, {0.52, 0.37}, {0.48, 0.37}, {0.56, 0.38}, {0.44, 0.38},
            {0.515, 0.45}, {0.485, 0.45}, {0.65, 0.62}, {0.35, 0.62}};

    private final JdbcTemplate jdbc;
    private final String schema;
    private final DefaultPolicy policy;

    public JdbcReportTestFixtures(JdbcTemplate jdbc,
                                  @Value("${service-db.schema:posture_service}") String schema,
                                  DefaultPolicy policy) {
        if (schema == null || !SCHEMA_NAME.matcher(schema).matches()) {
            throw new IllegalArgumentException("service-db.schema가 올바르지 않음: " + schema);
        }
        this.jdbc = jdbc;
        this.schema = schema;
        this.policy = policy;
    }

    private String t(String table) {
        return "`" + schema + "`." + table;
    }

    private long policyId() {
        String find = "SELECT threshold_policy_id FROM " + t("threshold_policy")
                + " WHERE threshold = ? AND hold_seconds = ? AND recover_seconds = ? AND realert_seconds = ?";
        Object[] values = {policy.threshold(), policy.holdSeconds(), policy.recoverSeconds(), policy.realertSeconds()};
        List<Long> ids = jdbc.queryForList(find, Long.class, values);
        if (ids.isEmpty()) {
            // UK-03 — 동시에 다른 쪽이 넣었으면 INSERT IGNORE가 건너뛰고 다시 찾는다
            jdbc.update("INSERT IGNORE INTO " + t("threshold_policy")
                            + " (threshold, hold_seconds, recover_seconds, realert_seconds, created_at) VALUES (?, ?, ?, ?, ?)",
                    policy.threshold(), policy.holdSeconds(), policy.recoverSeconds(), policy.realertSeconds(),
                    Timestamp.from(Instant.now().truncatedTo(ChronoUnit.MILLIS)));
            ids = jdbc.queryForList(find, Long.class, values);
        }
        return ids.get(0);
    }

    /** 시험 계정 1개 + 기준 자세 1개 + 그 계정의 세션 행 1개(측정 중). */
    public Map<String, Object> createSession(String clientSessionUuid, boolean alertEnabled, Instant startedAt) {
        long policyId = policyId();
        String email = "test-" + UUID.randomUUID() + EMAIL_SUFFIX;
        Timestamp now = Timestamp.from(Instant.now().truncatedTo(ChronoUnit.MILLIS));
        jdbc.update("INSERT INTO " + t("user_account")
                        + " (login_email, password_hash, display_name, joined_at, threshold_policy_id, sound_alert_enabled)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                email, "test-fixture-not-a-real-hash", "시험 계정", now, policyId, alertEnabled);
        long accountId = jdbc.queryForList("SELECT user_account_id FROM " + t("user_account") + " WHERE login_email = ?",
                Long.class, email).get(0);

        // (D-65) V2.5부터 등록 식별자(UUID, NOT NULL, UK-16 — 사용자·등록 식별자)가 필요하다(migration 015)
        StringBuilder cols = new StringBuilder("user_account_id, client_registration_uuid, registered_at");
        StringBuilder marks = new StringBuilder("?, ?, ?");
        Object[] args = new Object[3 + JOINTS.length * 2];
        args[0] = accountId;
        args[1] = UUID.randomUUID().toString();
        args[2] = now;
        for (int i = 0; i < JOINTS.length; i++) {
            cols.append(", ").append(JOINTS[i]).append("_x, ").append(JOINTS[i]).append("_y");
            marks.append(", ?, ?");
            args[3 + i * 2] = COORDS[i][0];
            args[4 + i * 2] = COORDS[i][1];
        }
        jdbc.update("INSERT INTO " + t("baseline_posture") + " (" + cols + ") VALUES (" + marks + ")", args);
        long baselineId = jdbc.queryForList("SELECT MAX(baseline_posture_id) FROM " + t("baseline_posture")
                + " WHERE user_account_id = ?", Long.class, accountId).get(0);

        jdbc.update("INSERT INTO " + t("monitor_session")
                        + " (client_session_uuid, user_account_id, baseline_posture_id, threshold_policy_id, alert_enabled, started_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                clientSessionUuid, accountId, baselineId, policyId, alertEnabled,
                Timestamp.from(startedAt.truncatedTo(ChronoUnit.MILLIS)));
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("client_session_uuid", clientSessionUuid);
        r.put("user_account_id", accountId);
        r.put("login_email", email);
        r.put("baseline_posture_id", baselineId);
        r.put("threshold_policy_id", policyId);
        r.put("alert_enabled", alertEnabled);
        return r;
    }

    /** 시험 계정의 세션만 지운다(하위 행은 CASCADE). 세션이 남지 않으면 계정도(기준 자세·동의는 CASCADE). @return 지운 세션 수 */
    public int deleteSession(String clientSessionUuid) {
        List<Long> account = jdbc.queryForList(
                "SELECT s.user_account_id FROM " + t("monitor_session") + " s JOIN " + t("user_account") + " u"
                        + " ON u.user_account_id = s.user_account_id"
                        + " WHERE s.client_session_uuid = ? AND u.login_email LIKE 'test-%' AND u.login_email LIKE ?",
                Long.class, clientSessionUuid, "%" + EMAIL_SUFFIX);
        if (account.isEmpty()) {
            return 0;
        }
        int n = jdbc.update("DELETE FROM " + t("monitor_session") + " WHERE client_session_uuid = ?", clientSessionUuid);
        jdbc.update("DELETE FROM " + t("user_account") + " WHERE user_account_id = ? AND NOT EXISTS"
                + " (SELECT 1 FROM " + t("monitor_session") + " WHERE user_account_id = ?) AND NOT EXISTS"
                + " (SELECT 1 FROM " + t("deletion_request") + " WHERE user_account_id = ?)",
                account.get(0), account.get(0), account.get(0));
        return n;
    }
}
