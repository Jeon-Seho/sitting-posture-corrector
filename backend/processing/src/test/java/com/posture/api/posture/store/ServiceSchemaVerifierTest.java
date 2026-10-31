package com.posture.api.posture.store;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

/** (D-32, D-41, D-51, D-65) 확정 서비스 DB(V2.6) 준비 확인. */
class ServiceSchemaVerifierTest {

	/** V2.6 스키마 + 시드 + 권한이 갖춰진 상태를 흉내 낸다. 필드를 바꿔 문제 상황을 만든다. */
	static final class FakeProbe implements ServiceDbProbe {
		final List<String> tables = new ArrayList<>(ServiceSchemaVerifier.EXPECTED_TABLES);
		final Map<String, List<String>> columns = new HashMap<>();
		Long defaultPolicyId = 1L;
		DefaultPolicy askedPolicy;
		List<String> privileges = new ArrayList<>(List.of("SELECT", "INSERT", "UPDATE", "DELETE"));
		RuntimeException failure;

		FakeProbe() {
			columns.putAll(ServiceSchemaVerifier.REQUIRED_COLUMNS);
			columns.put("daily_stat", List.of("user_account_id", "stat_date", "min_until_collapse_sec",
				"max_until_collapse_sec"));
			columns.put("feature_archive", List.of("feature_archive_id", "monitor_session_id", "file_uri"));
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
		public Optional<Long> policyIdByValues(String schema, DefaultPolicy policy) {
			askedPolicy = policy;
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
	static List<String> list(Map<String, Object> result, String key) {
		return (List<String>)result.get(key);
	}

	ServiceSchemaVerifier verifier(boolean enabled, String schema) {
		return new ServiceSchemaVerifier(probe, enabled, schema, DefaultPolicy.defaults(),
			() -> Instant.parse("2026-10-16T00:00:00Z"));
	}

	@Test
	void readyV26SchemaIsOk() {
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(true);
		assertThat(result.get("specVersion")).isEqualTo("V2.6");
		assertThat(result.get("tableCount")).isEqualTo(12);
		assertThat(result.get("defaultPolicyId")).isEqualTo(1L);
		assertThat(list(result, "problems")).isEmpty();
		assertThat(list(result, "warnings")).isEmpty();
	}

	/** 기본 정책은 이름이 아니라 값 4개로 찾고, 값은 DB 정밀도로 맞춘다(0.7 → 0.700, 3 → 3.0). */
	@Test
	void defaultPolicyIsLookedUpByFourValues() {
		verifier(true, "posture_service").check();
		assertThat(probe.askedPolicy.threshold()).isEqualByComparingTo(new BigDecimal("0.700"));
		assertThat(probe.askedPolicy.threshold().scale()).isEqualTo(3);
		assertThat(probe.askedPolicy.holdSeconds().toPlainString()).isEqualTo("3.0");
		assertThat(probe.askedPolicy.recoverSeconds().toPlainString()).isEqualTo("3.0");
		assertThat(probe.askedPolicy.realertSeconds()).isEqualTo(60);
	}

	/** 기본 정책 행이 없어도 문제가 아니다 — 입출구 서버가 첫 가입 때 만든다. */
	@Test
	void missingDefaultPolicyRowIsOnlyAWarning() {
		probe.defaultPolicyId = null;
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(true);
		assertThat(list(result, "warnings")).hasSize(1);
		assertThat(list(result, "warnings").get(0)).contains("행 없음");
	}

	/** 10/16 서버에서 본 것의 반대: V2.1 DB(옛 컬럼 있음, V2.3 컬럼·테이블 없음)는 문제로 나온다. */
	@Test
	void v21DatabaseIsReported() {
		probe.tables.remove("user_consent");
		probe.columns.put("daily_stat", List.of("user_account_id", "stat_date"));
		probe.columns.put("collapse_event", List.of("monitor_session_id", "event_seq", "started_at", "confirmed_at",
			"ended_at", "end_reason", "recovered_at"));
		probe.columns.put("correction_alert", List.of("monitor_session_id", "event_seq", "attempt_seq",
			"attempted_at", "delivered", "suppress_reason"));
		probe.columns.put("threshold_policy", List.of("threshold_policy_id", "threshold", "hold_seconds",
			"recover_seconds", "realert_seconds", "created_at", "policy_name", "created_by", "notify_max_per_hour"));
		probe.defaultPolicyId = null;
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(false);
		assertThat(result.get("specVersion")).isEqualTo("V2.1 이하");
		assertThat(list(result, "missingTables")).containsExactly("user_consent");
		assertThat(list(result, "removedColumnsPresent")).contains("collapse_event.end_reason",
			"correction_alert.attempt_seq", "threshold_policy.policy_name");
		assertThat(String.valueOf(result.get("problems"))).contains("V2.3 아님").contains("011_add_until_collapse");
		// 옛 정책 테이블이면 값으로 찾지 않는다(경고도 없음)
		assertThat(result).doesNotContainKey("defaultPolicyId");
	}

	/** 10/28 서버에서 본 것: 처리 서비스가 V2.3 기준이면 V2.6 DB의 기준 자세(등록 식별자 NOT NULL)를 못 넣는다 → 판을 알려 준다. */
	@Test
	void olderMinorVersionsNameTheMigrationsToApply() {
		probe.tables.remove("refresh_token");
		Map<String, Object> v25 = verifier(true, "posture_service").check();
		assertThat(v25.get("ok")).isEqualTo(false);
		assertThat(v25.get("specVersion")).isEqualTo("V2.5");
		assertThat(String.valueOf(v25.get("problems"))).contains("V2.6 아님").contains("migration 016을")
			.doesNotContain("V2.6 테이블 없음");

		probe.columns.put("baseline_posture", List.of("baseline_posture_id", "user_account_id", "registered_at"));
		Map<String, Object> v24 = verifier(true, "posture_service").check();
		assertThat(v24.get("specVersion")).isEqualTo("V2.4");
		assertThat(String.valueOf(v24.get("problems"))).contains("migration 015·016을");
		assertThat(list(v24, "missingColumns")).containsExactly("baseline_posture.client_registration_uuid");

		probe.columns.put("feature_archive",
			List.of("feature_archive_id", "monitor_session_id", "file_uri", "row_count"));
		Map<String, Object> v23 = verifier(true, "posture_service").check();
		assertThat(v23.get("specVersion")).isEqualTo("V2.3");
		assertThat(String.valueOf(v23.get("problems"))).contains("migration 013·014·015·016을");
	}

	@Test
	void missingBaselineColumnIsReported() {
		probe.columns.put("monitor_session", List.of("monitor_session_id", "client_session_uuid", "user_account_id",
			"threshold_policy_id", "alert_enabled", "started_at", "ended_at", "good_sec"));
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(false);
		assertThat(list(result, "missingColumns")).containsExactly("monitor_session.baseline_posture_id");
	}

	@Test
	void tableNamesAreCaseInsensitive() {
		probe.tables.remove("refresh_token");
		probe.tables.remove("user_consent");
		probe.tables.add("REFRESH_TOKEN");
		probe.tables.add("User_Consent");
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(true);
		assertThat(result.get("specVersion")).isEqualTo("V2.6");
	}

	/** V2.6부터 로그인은 토큰이라 SPRING_SESSION 테이블은 없어도 된다(DB에는 남겨 둠). */
	@Test
	void springSessionTablesAreNotRequired() {
		probe.tables.add("SPRING_SESSION");
		assertThat(verifier(true, "posture_service").check().get("ok")).isEqualTo(true);
		probe.tables.remove("SPRING_SESSION");
		assertThat(verifier(true, "posture_service").check().get("ok")).isEqualTo(true);
	}

	@Test
	void olderVersionTablesAreReported() {
		probe.tables.add("client_record");
		probe.tables.add("baseline_feature");
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(false);
		assertThat(list(result, "removedTablesPresent")).containsExactly("baseline_feature", "client_record");
	}

	@Test
	void missingSchemaAndPrivilegesAreReported() {
		probe.privileges = new ArrayList<>(List.of("SELECT"));
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(false);
		assertThat(list(result, "missingPrivileges")).containsExactly("INSERT", "UPDATE", "DELETE");

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
		Map<String, Object> result = verifier(true, "posture_service").check();
		assertThat(result.get("ok")).isEqualTo(false);
		assertThat(String.valueOf(result.get("problems"))).contains("Communications link failure");

		assertThat(String.valueOf(verifier(true, "x`; DROP").check().get("problems"))).contains("올바르지 않음");
		assertThat(verifier(false, "posture_service").check().get("ok")).isEqualTo(false);
	}
}
