package com.posture.api.posture.store;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-32) 확정 서비스 DB(V2.1) 준비 확인. */
class ServiceSchemaVerifierTest {

    /** V2.1 스키마 + 시드 + 권한이 갖춰진 상태를 흉내 낸다. 필드를 바꿔 문제 상황을 만든다. */
    static final class FakeProbe implements ServiceDbProbe {
        final List<String> tables = new ArrayList<>(ServiceSchemaVerifier.EXPECTED_TABLES);
        final Map<String, List<String>> columns = new HashMap<>();
        Long defaultPolicyId = 1L;
        List<String> privileges = new ArrayList<>(List.of("SELECT", "INSERT", "UPDATE", "DELETE"));
        RuntimeException failure;

        FakeProbe() {
            columns.putAll(ServiceSchemaVerifier.REQUIRED_COLUMNS);
            columns.put("user_account", List.of("user_account_id", "login_email", "threshold_policy_id"));
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
        return new ServiceSchemaVerifier(probe, enabled, schema, "DEFAULT_TEMP",
                () -> Instant.parse("2026-10-10T00:00:00Z"));
    }

    @Test
    void readyV21SchemaIsOk() {
        Map<String, Object> r = verifier(true, "posture_service").check();
        assertThat(r.get("ok")).isEqualTo(true);
        assertThat(r.get("tableCount")).isEqualTo(12);
        assertThat(r.get("defaultPolicyId")).isEqualTo(1L);
        assertThat(list(r, "problems")).isEmpty();
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
