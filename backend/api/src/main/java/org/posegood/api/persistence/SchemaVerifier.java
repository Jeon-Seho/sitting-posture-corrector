package org.posegood.api.persistence;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;

/**
 * The API does not create or migrate tables. `database/schema/schema_V1_1.sql` and the seeds are
 * applied by the DB owner's procedure (Compose runs them on an empty volume); this check refuses to
 * start against an older schema such as the retired V1 Flyway tables.
 */
@Component
@Profile("persistent")
public class SchemaVerifier implements ApplicationRunner {
    private static final List<String> TABLES =
            List.of(
                    "threshold_policy",
                    "user_account",
                    "capture_device",
                    "feature_def",
                    "baseline_posture",
                    "baseline_feature",
                    "model_version",
                    "monitor_session",
                    "excluded_interval",
                    "feature_archive",
                    "collapse_event",
                    "correction_alert",
                    "daily_stat",
                    "deletion_request",
                    "error_log",
                    "input_result",
                    "cep_outbox",
                    "confirmed_snapshot",
                    "cep_cleanup",
                    "SPRING_SESSION",
                    "SPRING_SESSION_ATTRIBUTES",
                    "client_record");
    private final JdbcTemplate jdbc;
    private final String defaultPolicy;
    private final String modelVersionCode;

    public SchemaVerifier(
            JdbcTemplate jdbc,
            @Value("${posegood.default-policy-name:DEFAULT_TEMP}") String defaultPolicy,
            @Value("${posegood.model-version-code:REFERENCE-RULE-1}") String modelVersionCode) {
        this.jdbc = jdbc;
        this.defaultPolicy = defaultPolicy;
        this.modelVersionCode = modelVersionCode;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        var present =
                new HashSet<>(
                        jdbc.queryForList(
                                "SELECT table_name FROM information_schema.tables WHERE"
                                        + " table_schema=DATABASE()",
                                String.class));
        var missing = TABLES.stream().filter(table -> !present.contains(table)).toList();
        if (!missing.isEmpty())
            throw new IllegalStateException(
                    "database schema V1.1 is not applied; missing tables " + missing);
        Integer columns =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM information_schema.columns WHERE"
                                + " table_schema=DATABASE() AND table_name='user_account' AND"
                                + " column_name IN ('auth_epoch','age','occupation')",
                        Integer.class);
        if (columns == null || columns != 3)
            throw new IllegalStateException("database schema V1.1 user_account columns missing");
        require(
                "SELECT COUNT(*) FROM threshold_policy WHERE policy_name=?",
                defaultPolicy,
                "default threshold policy seed");
        require(
                "SELECT COUNT(*) FROM model_version WHERE model_version_code=?",
                modelVersionCode,
                "model version seed");
        Integer features =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM feature_def WHERE feature_code IN"
                                + " ('HEAD_GAP','LATERAL_OFFSET','SHOULDER_TILT')",
                        Integer.class);
        if (features == null || features != 3)
            throw new IllegalStateException("feature_def seed is missing");
    }

    private void require(String sql, String value, String name) {
        Integer count = jdbc.queryForObject(sql, Integer.class, value);
        if (count == null || count != 1) throw new IllegalStateException(name + " is missing");
    }
}
