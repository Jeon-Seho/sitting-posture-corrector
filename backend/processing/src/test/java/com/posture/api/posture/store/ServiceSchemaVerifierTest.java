package com.posture.api.posture.store;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-32, D-41) 확정 서비스 DB(V2.2) 준비 확인. */
class ServiceSchemaVerifierTest {

    /** V2.2 스키마 + 시드 + 권한이 갖춰진 상태를 흉내 낸다. 필드를 바꿔 문제 상황을 만든다. */
    static final class FakeProbe implements ServiceDbProbe {
        final List<String> tables = new ArrayList<>(ServiceSchemaVerifier.EXPECTED_TABLES);
        final Map<String, List<String>> columns = new HashMap<>();
        Long defaultPolicyId = 1L;
        Double defaultThreshold = 0.7;
        List<String> privileges = new ArrayList<>(List.of("SELECT", "INSERT", "UPDATE", "DELETE"));
        RuntimeException failure;

        FakeProbe() {
            columns.putAll(ServiceSchemaVerifier.REQUIRED_COLUMNS);
            columns.put("user_account", List.of("user_account_id", "login_email", "threshold_policy_id",
                    "alert_enabled", "sound_alert_enabled"));
        }

        @Override
        public List<String> tables(String schema) {
            if (failure != null) {
                throw failure;
            }
            return tables;
        }

        @Override
        public List<String> columns(String schema, String table) {
            return columns.getOrDefault(table, List.of());
        }

        @Override
        public Optional<Long> policyIdByName(String schema, String policyName) {
            return Optional.ofNullable(defaultPolicyId);
        }

        @Override
        public Optional<Double> policyThreshold(String schema, String policyName) {
            return Optional.ofNullable(defaultThreshold);
        }

        @Override
        public List<String> privileges(String schema) {
            return privileges;
        }
    }

    final FakeProbe probe = new FakeProbe();

    /** 검사 결과의 목록 값(문자열 목록)을 꺼낸다. */
    @SuppressWarnings("unchecked")
    static List<String> list(Map<String, Object> r, String key) {
        return (List<String>) r.get(key);
    }

    ServiceSchemaVerifier verifier(boolean enabled, String schema) {
        return verifier(enabled, schema, "V2.2");
    }

    ServiceSchemaVerifier verifier(boolean enabled, String schema, String target) {
        return new ServiceSchemaVerifier(probe, enabled, schema, "DEFAULT_TEMP", 0.7, target,
                () -> Instant.parse("2026-10-10T00:00:00Z"));
    }

    @Test
    void readyV22SchemaIsOk() {
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(true);
        assertThat(r.get("specVersion")).isEqualTo("V2.2");
        assertThat(r.get("tableCount")).isEqualTo(12);
        assertThat(r.get("defaultPolicyId")).isEqualTo(1L);
        assertThat(r.get("defaultPolicyThreshold")).isEqualTo(0.7);
        assertThat(list(r, "problems")).isEmpty();
    }

    /** (D-41) V2.1로 만들고 migration 011·시드 수정을 안 한 DB: alert_enabled 없음, threshold 0.5. */
    @Test
    void v21DatabaseWithoutMigration011IsReported() {
        probe.columns.put("user_account", List.of("user_account_id", "login_email", "threshold_policy_id",
                "sound_alert_enabled"));
        probe.defaultThreshold = 0.5;
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(false);
        assertThat(r.get("specVersion")).isEqualTo("V2.1");
        assertThat(list(r, "missingColumns")).containsExactly("user_account.alert_enabled");
        List<String> problems = list(r, "problems");
        assertThat(problems).hasSize(2);
        assertThat(problems.get(0)).contains("V2.2 아님").contains("011_add_alert_enabled_user_account.sql");
        assertThat(problems.get(1)).contains("threshold 0.5").contains("0.7");
    }

    /** (D-41) 목표 V2.1(서버 DB 당분간 V2.1): 같은 DB가 준비됨으로 보이고 V2.2 항목은 경고로만. */
    @Test
    void v21TargetTurnsV22ItemsIntoWarnings() {
        probe.columns.put("user_account", List.of("user_account_id", "login_email", "threshold_policy_id",
                "sound_alert_enabled"));
        probe.defaultThreshold = 0.5;
        Map<String, Object> r = verifier(true, "posture_service", "V2.1").check();
        assertThat(r.get("ok")).isEqualTo(true);
        assertThat(r.get("targetSpecVersion")).isEqualTo("V2.1");
        assertThat(r.get("specVersion")).isEqualTo("V2.1");
        assertThat(list(r, "problems")).isEmpty();
        assertThat(list(r, "warnings")).hasSize(2);

        probe.columns.put("user_account", List.of("user_account_id", "threshold_policy_id", "alert_enabled"));
        probe.defaultThreshold = 0.7;
        Map<String, Object> v22 = verifier(true, "posture_service", "V2.1").check();
        assertThat(v22.get("specVersion")).isEqualTo("V2.2");
        assertThat(list(v22, "warnings")).isEmpty();
    }

    @Test
    void thresholdWithinDecimalPrecisionIsOk() {
        probe.defaultThreshold = 0.7000000001;
        assertThat(verifier(true, "posture_service").check().get("ok")).isEqualTo(true);
    }

    @Test
    void tableNamesAreCaseInsensitive() {
        probe.tables.remove("SPRING_SESSION");
        probe.tables.remove("SPRING_SESSION_ATTRIBUTES");
        probe.tables.add("spring_session");
        probe.tables.add("spring_session_attributes");
        assertThat(verifier(true, "posture_service").check().get("ok")).isEqualTo(true);
    }

    @Test
    void olderVersionDatabaseIsReported() {
        probe.tables.add("client_record");
        probe.tables.add("baseline_feature");
        probe.columns.put("monitor_session", List.of("monitor_session_id", "client_session_uuid", "user_account_id",
                "baseline_posture_id", "threshold_policy_id", "alert_enabled", "started_at", "ended_at", "end_reason",
                "good_sec", "frame_width"));
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(false);
        assertThat(list(r, "removedTablesPresent")).containsExactly("baseline_feature", "client_record");
        assertThat(list(r, "missingColumns")).containsExactly("monitor_session.calibration_uuid");
        assertThat(list(r, "removedColumnsPresent"))
                .containsExactly("monitor_session.baseline_posture_id", "monitor_session.frame_width");
    }

    @Test
    void missingSchemaSeedAndPrivilegesAreReported() {
        probe.defaultPolicyId = null;
        probe.privileges = new ArrayList<>(List.of("SELECT"));
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(false);
        assertThat(list(r, "missingPrivileges")).containsExactly("INSERT", "UPDATE", "DELETE");
        assertThat(String.valueOf(r.get("problems"))).contains("DEFAULT_TEMP");

        probe.tables.clear();
        Map<String, Object> empty = verifier(true, "posture_service").check();
        assertThat(String.valueOf(empty.get("problems"))).contains("없거나 테이블이 없음");
    }

    @Test
    void allPrivilegesGrantCounts() {
        probe.privileges = new ArrayList<>(List.of("ALL PRIVILEGES"));
        assertThat(verifier(true, "posture_service").check().get("ok")).isEqualTo(true);
    }

    @Test
    void failuresAndBadNamesDoNotThrow() {
        probe.failure = new IllegalStateException("Communications link failure");
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(false);
        assertThat(String.valueOf(r.get("problems"))).contains("Communications link failure");

        assertThat(String.valueOf(verifier(true, "x`; DROP").check().get("problems"))).contains("올바르지 않음");
        assertThat(verifier(false, "posture_service").check().get("ok")).isEqualTo(false);
    }
}
