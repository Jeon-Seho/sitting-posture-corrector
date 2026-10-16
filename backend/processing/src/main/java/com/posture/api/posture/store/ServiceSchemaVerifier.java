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
 * (D-32, D-41, D-51) 판정 결과를 옮겨 쓸 확정 서비스 DB(DB 명세서 V2.3, {@code posture_service})가 준비됐는지 확인한다.
 * 서버 DB는 팀 {@code backend/api} 기준 V2.3으로 최신화됐다(10/14). 예전 버전(V2.1·V2.2) 판별은 하지 않고, V2.3이 아니면 문제로 본다.
 *
 * <ul>
 *   <li>테이블 13개({@code user_consent} 포함)가 있는지, 지운 테이블(V1.1·V2.0)이 남아 있지 않은지.</li>
 *   <li>판정 결과 저장(D-30)이 쓸 컬럼이 있는지, V2.2에서 지운 컬럼이 남아 있지 않은지(남아 있으면 V2.1 DB).</li>
 *   <li>V2.3 표시: {@code daily_stat.min_until_collapse_sec}(migration 011)·{@code user_consent}(migration 012).</li>
 *   <li>기본 판정 정책: V2.3은 이름이 없고 값 4개(threshold·hold·recover·realert, UK-03)로 찾는다. 입출구 서버가 가입 때 없으면 만들므로
 *       행이 없는 것은 문제가 아니라 경고로만 알린다.</li>
 *   <li>지금 계정에 SELECT·INSERT·UPDATE·DELETE 권한이 있는지.</li>
 * </ul>
 *
 * <p>검사만 하고 아무것도 만들거나 고치지 않는다(스키마는 DB 담당의 {@code schema_V2_3.sql}로 만든다).
 * 결과가 나빠도 api-server는 그대로 뜬다. 앱 기동 직후 한 번 로그로 남기고, {@code GET /cep/service-db}로 다시 확인한다.
 * 테이블 이름은 대소문자를 구분하지 않는다(Windows MySQL은 {@code lower_case_table_names=1}).
 */
@Component
public class ServiceSchemaVerifier {

    private static final Logger log = LoggerFactory.getLogger(ServiceSchemaVerifier.class);
    private static final Pattern SCHEMA_NAME = Pattern.compile("[A-Za-z0-9_]{1,64}");

    static final String SPEC_VERSION = "V2.3";

    static final List<String> EXPECTED_TABLES = List.of(
            "threshold_policy", "user_account", "baseline_posture", "monitor_session", "excluded_interval",
            "feature_archive", "collapse_event", "correction_alert", "daily_stat", "deletion_request",
            "user_consent", "SPRING_SESSION", "SPRING_SESSION_ATTRIBUTES");

    /** V1.1·V2.0에 있었고 V2.1에서 지운 테이블. 하나라도 있으면 예전 버전 DB. */
    static final List<String> REMOVED_TABLES = List.of(
            "feature_def", "safety_range", "baseline_feature", "client_record", "capture_device", "model_version",
            "input_result", "cep_outbox", "confirmed_snapshot", "cep_cleanup", "deployment", "error_log");

    /** 판정 결과 저장(D-30)과 시험 행(시험용 API)이 쓸 컬럼. */
    static final Map<String, List<String>> REQUIRED_COLUMNS = Map.of(
            "monitor_session", List.of("monitor_session_id", "client_session_uuid", "user_account_id",
                    "baseline_posture_id", "threshold_policy_id", "alert_enabled", "started_at", "ended_at",
                    "good_sec"),
            "collapse_event", List.of("monitor_session_id", "event_seq", "started_at", "confirmed_at", "ended_at",
                    "recovered_at"),
            "correction_alert", List.of("monitor_session_id", "event_seq", "attempted_at"),
            "excluded_interval", List.of("monitor_session_id", "started_at", "ended_at", "exclusion_reason"),
            "threshold_policy", List.of("threshold_policy_id", "threshold", "hold_seconds", "recover_seconds",
                    "realert_seconds", "created_at"),
            "user_account", List.of("user_account_id", "login_email", "threshold_policy_id", "sound_alert_enabled"),
            "baseline_posture", List.of("baseline_posture_id", "user_account_id", "registered_at"));

    /** V2.3 표시 컬럼(migration 011). 없으면 V2.2 이하. */
    static final String V23_COLUMN = "daily_stat.min_until_collapse_sec";

    /** V2.2에서 지운 컬럼(있으면 V2.1 이하로 만든 DB) + V2.1에서 지운 컬럼. */
    static final Map<String, List<String>> REMOVED_COLUMNS = Map.of(
            "monitor_session", List.of("calibration_uuid", "end_reason", "frame_width", "frame_height",
                    "capture_device_id", "model_version_code"),
            "collapse_event", List.of("end_reason"),
            "correction_alert", List.of("correction_alert_id", "attempt_seq", "delivered", "suppress_reason"),
            "threshold_policy", List.of("policy_name", "created_by", "notify_max_per_hour"),
            "user_account", List.of("auth_epoch"));

    static final List<String> REQUIRED_PRIVILEGES = List.of("SELECT", "INSERT", "UPDATE", "DELETE");

    private final ServiceDbProbe probe;
    private final boolean enabled;
    private final String schema;
    private final DefaultPolicy defaultPolicy;
    private final Supplier<Instant> clock;

    @Autowired
    public ServiceSchemaVerifier(
            ServiceDbProbe probe,
            @Value("${service-db.enabled:true}") boolean enabled,
            @Value("${service-db.schema:posture_service}") String schema,
            DefaultPolicy defaultPolicy) {
        this(probe, enabled, schema, defaultPolicy, Instant::now);
    }

    ServiceSchemaVerifier(ServiceDbProbe probe, boolean enabled, String schema, DefaultPolicy defaultPolicy,
                          Supplier<Instant> clock) {
        this.probe = probe;
        this.enabled = enabled;
        this.schema = schema;
        this.defaultPolicy = defaultPolicy;
        this.clock = clock;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void checkOnStartup() {
        if (!enabled) {
            log.info("서비스 DB 확인: 사용 안 함 (SERVICE_DB_ENABLED=false)");
            return;
        }
        Map<String, Object> r = check();
        if (Boolean.TRUE.equals(r.get("ok"))) {
            log.info("서비스 DB 확인: 준비됨 (schema={}, {}, 기본 정책 {} = id {}, 경고 {})", schema, r.get("specVersion"),
                    defaultPolicy, r.get("defaultPolicyId"), r.get("warnings"));
        } else {
            log.warn("서비스 DB 확인: 준비 안 됨 (schema={}) — {} (판정 경로는 영향 없음, GET /cep/service-db)",
                    schema, r.get("problems"));
        }
    }

    /** 지금 상태를 검사한다. 예외를 밖으로 던지지 않는다. */
    public Map<String, Object> check() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", enabled);
        r.put("schema", schema);
        r.put("checkedAt", clock.get().toString());
        r.put("targetSpecVersion", SPEC_VERSION);
        List<String> problems = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
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
                problems.add("V2.3 테이블 없음: " + missing);
            }
            if (!removed.isEmpty()) {
                problems.add("V2.1에서 지운 테이블이 남아 있음(예전 버전 DB): " + removed);
            }

            List<String> missingCols = new ArrayList<>();
            List<String> removedCols = new ArrayList<>();
            Map<String, List<String>> required = new LinkedHashMap<>(REQUIRED_COLUMNS);
            required.put("daily_stat", List.of("min_until_collapse_sec"));
            for (String table : new TreeSet<>(required.keySet())) {
                if (!tables.contains(table)) {
                    continue;
                }
                Set<String> cols = lower(probe.columns(schema, table));
                for (String c : required.get(table)) {
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
            r.put("missingColumns", List.copyOf(missingCols));
            r.put("removedColumnsPresent", removedCols);
            boolean v23 = tables.contains("user_consent") && !missingCols.contains(V23_COLUMN)
                    && tables.contains("daily_stat");
            r.put("specVersion", v23 ? SPEC_VERSION
                    : (removedCols.isEmpty() ? "V2.2 이하" : "V2.1 이하"));
            if (missingCols.remove(V23_COLUMN)) {
                problems.add("V2.3 아님: " + V23_COLUMN + " 없음 (database/migrations/011_add_until_collapse_daily_stat.sql)");
            }
            if (!missingCols.isEmpty()) {
                problems.add("판정 결과 저장에 쓸 컬럼 없음: " + missingCols);
            }
            if (!removedCols.isEmpty()) {
                problems.add("V2.2에서 지운 컬럼이 남아 있음(예전 버전 DB — schema_V2_3.sql로 다시 만듦): " + removedCols);
            }

            if (tables.contains("threshold_policy") && removedCols.stream().noneMatch(c -> c.startsWith("threshold_policy."))
                    && missingCols.stream().noneMatch(c -> c.startsWith("threshold_policy."))) {
                Optional<Long> id = probe.policyIdByValues(schema, defaultPolicy);
                r.put("defaultPolicy", defaultPolicy.toMap());
                r.put("defaultPolicyId", id.orElse(null));
                if (id.isEmpty()) {
                    warnings.add("기본 판정 정책 " + defaultPolicy + " 행 없음 — 입출구 서버가 첫 가입 때 만든다"
                            + " (seed_04_threshold_policy.sql과 값이 다르면 SERVICE_DB_DEFAULT_* 확인)");
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
        r.put("warnings", warnings);
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
