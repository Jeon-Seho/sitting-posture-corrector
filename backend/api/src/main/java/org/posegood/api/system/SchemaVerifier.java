package org.posegood.api.system;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;

/**
 * The API never creates or migrates tables. `database/schema/schema_V2_2.sql` and the seed are
 * applied by the DB owner's procedure (a V2.1 database gets migration 011); startup fails against
 * another schema version.
 */
@Component
public class SchemaVerifier implements ApplicationRunner {
    static final List<String> TABLES =
            List.of(
                    "threshold_policy",
                    "user_account",
                    "baseline_posture",
                    "monitor_session",
                    "excluded_interval",
                    "feature_archive",
                    "collapse_event",
                    "correction_alert",
                    "daily_stat",
                    "deletion_request",
                    "SPRING_SESSION",
                    "SPRING_SESSION_ATTRIBUTES");
    /** Dropped by V2.0 (CR-04) or V2.1; finding one means the database was not rebuilt. */
    static final List<String> RETIRED =
            List.of(
                    "capture_device",
                    "model_version",
                    "deployment",
                    "error_log",
                    "input_result",
                    "cep_outbox",
                    "confirmed_snapshot",
                    "cep_cleanup",
                    "feature_def",
                    "safety_range",
                    "baseline_feature",
                    "client_record");

    private final JdbcTemplate jdbc;
    private final String defaultPolicy;

    public SchemaVerifier(JdbcTemplate jdbc, @Value("${posegood.default-policy-name}") String defaultPolicy) {
        this.jdbc = jdbc;
        this.defaultPolicy = defaultPolicy;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        // A Windows server (lower_case_table_names=1) reports SPRING_SESSION as spring_session.
        var present = new HashSet<String>();
        for (var table :
                jdbc.queryForList(
                        "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()",
                        String.class)) present.add(table.toLowerCase(Locale.ROOT));
        var missing = TABLES.stream().filter(table -> !present.contains(table.toLowerCase(Locale.ROOT))).toList();
        if (!missing.isEmpty())
            throw new IllegalStateException("database schema V2.2 is not applied; missing " + missing);
        var retired = RETIRED.stream().filter(table -> present.contains(table.toLowerCase(Locale.ROOT))).toList();
        if (!retired.isEmpty())
            throw new IllegalStateException(
                    "database has tables removed in V2.0/V2.1 " + retired + "; rebuild it (database/README.md)");
        // V2.1 rebuilt baseline_posture as one row per user; V2.2 added user_account.alert_enabled.
        if (!hasColumn("baseline_posture", "nose_x") || hasColumn("baseline_posture", "baseline_posture_id"))
            throw new IllegalStateException("baseline_posture is not schema V2.1 or later; rebuild the database");
        if (!hasColumn("user_account", "alert_enabled"))
            throw new IllegalStateException(
                    "user_account.alert_enabled is missing; apply migrations/011 (schema V2.2)");
        Integer policy =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM threshold_policy WHERE policy_name=?", Integer.class, defaultPolicy);
        if (policy == null || policy != 1)
            throw new IllegalStateException("default threshold policy seed is missing");
    }

    private boolean hasColumn(String table, String column) {
        Integer count =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()"
                                + " AND table_name=? AND column_name=?",
                        Integer.class,
                        table,
                        column);
        return count != null && count > 0;
    }
}
