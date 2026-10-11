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
 * 시작할 때 DB가 V2.2 스키마인지 확인하고, 아니면 시작을 막는다.
 *
 * API는 테이블을 만들거나 고치지 않는다. 스키마와 시드는 DB 담당 절차로 적용한다
 * (V2.1 DB는 마이그레이션 011).
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
    /** V2.0(CR-04)·V2.1에서 지운 테이블. 하나라도 있으면 DB를 다시 만들지 않은 것이다. */
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

    /** 테이블, 필요한 컬럼, 기본 정책 시드를 확인한다. */
    @Override
    public void run(ApplicationArguments arguments) {
        // Windows MySQL(lower_case_table_names=1)은 SPRING_SESSION을 spring_session으로 보여 준다.
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
        // V2.1에서 baseline_posture를 사용자당 1행으로 바꿨고, V2.2에서 user_account.alert_enabled를 추가했다.
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
