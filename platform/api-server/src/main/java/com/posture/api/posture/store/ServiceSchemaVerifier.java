package com.posture.api.posture.store;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * (D-32) 판정 결과를 옮겨 쓸 확정 서비스 DB(DB 명세서 V2.1, {@code posture_service})가 준비됐는지 확인한다.
 *
 * <ul>
 *   <li>테이블 12개가 있는지, 지운 테이블(V1.1·V2.0)이 남아 있지 않은지 — 남아 있으면 예전 버전으로 만든 DB다.</li>
 *   <li>판정 결과 저장(D-30)이 쓸 컬럼이 있는지, V2.1에서 지운 컬럼이 없는지.</li>
 *   <li>기본 판정 정책(시드 {@code DEFAULT_TEMP})이 있는지.</li>
 *   <li>지금 계정에 SELECT·INSERT·UPDATE·DELETE 권한이 있는지.</li>
 * </ul>
 *
 * <p>검사만 하고 아무것도 만들거나 고치지 않는다(스키마는 DB 담당의 {@code schema_V2_1.sql}로 만든다).
 * 결과가 나빠도 api-server는 그대로 뜬다 — 지금 판정 경로는 이 DB에 쓰지 않는다. 앱 기동 직후 한 번 로그로 남기고,
 * {@code GET /cep/service-db}로 다시 확인한다. 테이블 이름은 대소문자를 구분하지 않는다
 * (Windows MySQL은 {@code lower_case_table_names=1}이라 {@code SPRING_SESSION}이 소문자로 저장될 수 있음).
 */
@Component
public class ServiceSchemaVerifier {

    private static final Logger log = LoggerFactory.getLogger(ServiceSchemaVerifier.class);
    private static final Pattern SCHEMA_NAME = Pattern.compile("[A-Za-z0-9_]{1,64}");

    static final List<String> EXPECTED_TABLES = List.of(
            "threshold_policy", "user_account", "baseline_posture", "monitor_session", "excluded_interval",
            "feature_archive", "collapse_event", "correction_alert", "daily_stat", "deletion_request",
            "SPRING_SESSION", "SPRING_SESSION_ATTRIBUTES");

    /** V1.1·V2.0에 있었고 V2.1에서 지운 테이블. 하나라도 있으면 예전 버전 DB. */
    static final List<String> REMOVED_TABLES = List.of(
            "feature_def", "safety_range", "baseline_feature", "client_record", "capture_device", "model_version",
            "input_result", "cep_outbox", "confirmed_snapshot", "cep_cleanup", "deployment", "error_log");

    /** 판정 결과 저장(D-30)이 쓸 컬럼. */
    static final Map<String, List<String>> REQUIRED_COLUMNS = Map.of(
            "monitor_session", List.of("monitor_session_id", "client_session_uuid", "user_account_id",
                    "calibration_uuid", "threshold_policy_id", "alert_enabled", "started_at", "ended_at",
                    "end_reason", "good_sec"),
            "collapse_event", List.of("monitor_session_id", "event_seq", "started_at", "confirmed_at", "ended_at",
                    "end_reason", "recovered_at"),
            "correction_alert", List.of("monitor_session_id", "event_seq", "attempt_seq", "attempted_at",
                    "delivered", "suppress_reason"),
            "excluded_interval", List.of("monitor_session_id", "started_at", "ended_at", "exclusion_reason"),
            "threshold_policy", List.of("threshold_policy_id", "threshold", "hold_seconds", "recover_seconds",
                    "realert_seconds", "notify_max_per_hour", "policy_name", "created_by"));

    /** V2.1에서 지운 컬럼(있으면 예전 버전). */
    static final Map<String, List<String>> REMOVED_COLUMNS = Map.of(
            "monitor_session", List.of("baseline_posture_id", "frame_width", "frame_height", "capture_device_id",
                    "model_version_code"),
            "user_account", List.of("auth_epoch"));

    static final List<String> REQUIRED_PRIVILEGES = List.of("SELECT", "INSERT", "UPDATE", "DELETE");

    private final ServiceDbProbe probe;
    private final boolean enabled;
    private final String schema;
    private final String defaultPolicyName;
    private final Supplier<Instant> clock;

    @Autowired
    public ServiceSchemaVerifier(
            ServiceDbProbe probe,
            @Value("${service-db.enabled:true}") boolean enabled,
            @Value("${service-db.schema:posture_service}") String schema,
            @Value("${service-db.default-policy-name:DEFAULT_TEMP}") String defaultPolicyName) {
        this(probe, enabled, schema, defaultPolicyName, Instant::now);
    }

    ServiceSchemaVerifier(ServiceDbProbe probe, boolean enabled, String schema, String defaultPolicyName,
                          Supplier<Instant> clock) {
        this.probe = probe;
        this.enabled = enabled;
        this.schema = schema;
        this.defaultPolicyName = defaultPolicyName;
        this.clock = clock;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void checkOnStartup() {
        if (!enabled) {
            log.info("서비스 DB(V2.1) 확인: 사용 안 함 (SERVICE_DB_ENABLED=false)");
            return;
        }
        Map<String, Object> r = check();
        if (Boolean.TRUE.equals(r.get("ok"))) {
            log.info("서비스 DB(V2.1) 확인: 준비됨 (schema={}, 기본 정책 {}={})", schema, defaultPolicyName,
                    r.get("defaultPolicyId"));
        } else {
            log.warn("서비스 DB(V2.1) 확인: 준비 안 됨 (schema={}) — {} (판정 경로는 영향 없음, GET /cep/service-db)",
                    schema, r.get("problems"));
        }
    }

    /** 지금 상태를 검사한다. 예외를 밖으로 던지지 않는다. */
    public Map<String, Object> check() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", enabled);
        r.put("schema", schema);
        r.put("checkedAt", clock.get().toString());
        List<String> problems = new ArrayList<>();
        if (!enabled) {
            r.put("ok", false);
            r.put("problems", List.of("사용 안 함 (SERVICE_DB_ENABLED=false)"));
            return r;
        }
        if (schema == null || !SCHEMA_NAME.matcher(schema).matches()) {
            r.put("ok", false);
            r.put("problems", List.of("스키마 이름이 올바르지 않음: " + schema));
            return r;
        }
        try {
            Set<String> tables = lower(probe.tables(schema));
            r.put("tableCount", tables.size());
            if (tables.isEmpty()) {
                problems.add("스키마 " + schema + "가 없거나 테이블이 없음 (또는 권한 없음)");
            }
            List<String> missing = new ArrayList<>();
            for (String t : EXPECTED_TABLES) {
                if (!tables.contains(t.toLowerCase(Locale.ROOT))) {
                    missing.add(t);
                }
            }
            List<String> removed = new ArrayList<>();
            for (String t : REMOVED_TABLES) {
                if (tables.contains(t.toLowerCase(Locale.ROOT))) {
                    removed.add(t);
                }
            }
            r.put("missingTables", missing);
            r.put("removedTablesPresent", removed);
            if (!tables.isEmpty() && !missing.isEmpty()) {
                problems.add("V2.1 테이블 없음: " + missing);
            }
            if (!removed.isEmpty()) {
                problems.add("V2.1에서 지운 테이블이 남아 있음(예전 버전 DB): " + removed);
            }

            List<String> missingCols = new ArrayList<>();
            List<String> removedCols = new ArrayList<>();
            for (String table : new TreeSet<>(REQUIRED_COLUMNS.keySet())) {
                if (!tables.contains(table)) {
                    continue;
                }
                Set<String> cols = lower(probe.columns(schema, table));
                for (String c : REQUIRED_COLUMNS.get(table)) {
                    if (!cols.contains(c)) {
                        missingCols.add(table + "." + c);
                    }
                }
                for (String c : REMOVED_COLUMNS.getOrDefault(table, List.of())) {
                    if (cols.contains(c)) {
                        removedCols.add(table + "." + c);
                    }
                }
            }
            if (tables.contains("user_account")) {
                Set<String> cols = lower(probe.columns(schema, "user_account"));
                for (String c : REMOVED_COLUMNS.get("user_account")) {
                    if (cols.contains(c)) {
                        removedCols.add("user_account." + c);
                    }
                }
            }
            r.put("missingColumns", missingCols);
            r.put("removedColumnsPresent", removedCols);
            if (!missingCols.isEmpty()) {
                problems.add("판정 결과 저장에 쓸 컬럼 없음: " + missingCols);
            }
            if (!removedCols.isEmpty()) {
                problems.add("V2.1에서 지운 컬럼이 남아 있음(예전 버전 DB): " + removedCols);
            }

            if (tables.contains("threshold_policy")) {
                Optional<Long> id = probe.policyIdByName(schema, defaultPolicyName);
                r.put("defaultPolicyName", defaultPolicyName);
                r.put("defaultPolicyId", id.orElse(null));
                if (id.isEmpty()) {
                    problems.add("기본 판정 정책 " + defaultPolicyName + " 없음 (seed_04_threshold_policy.sql)");
                }
            }

            Set<String> privs = upper(probe.privileges(schema));
            List<String> missingPrivs = new ArrayList<>();
            if (!privs.contains("ALL PRIVILEGES")) {
                for (String p : REQUIRED_PRIVILEGES) {
                    if (!privs.contains(p)) {
                        missingPrivs.add(p);
                    }
                }
            }
            r.put("missingPrivileges", missingPrivs);
            if (!missingPrivs.isEmpty()) {
                problems.add("계정 권한 부족 (" + schema + ".*): " + missingPrivs);
            }
        } catch (RuntimeException exc) {
            problems.add("조회 실패: " + exc.getMessage());
        }
        r.put("ok", problems.isEmpty());
        r.put("problems", problems);
        return r;
    }

    private static Set<String> lower(List<String> names) {
        Set<String> s = new TreeSet<>();
        for (String n : names) {
            if (n != null) {
                s.add(n.toLowerCase(Locale.ROOT));
            }
        }
        return s;
    }

    private static Set<String> upper(List<String> names) {
        Set<String> s = new TreeSet<>();
        for (String n : names) {
            if (n != null) {
                s.add(n.trim().toUpperCase(Locale.ROOT));
            }
        }
        return s;
    }
}
