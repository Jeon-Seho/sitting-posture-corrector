package org.posegood.api.system;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 시작할 때 DB V2.8의 저장 계약을 확인한다.
 *
 * API는 테이블을 만들거나 고치지 않는다. 스키마와 시드는 DB 담당 절차로 적용한다
 * (V2.7 → V2.8은 마이그레이션 018·019. V2.6 이하 DB는 마이그레이션 없이 `schema_V2_8.sql`로 다시 만든다).
 * 비밀번호는 V2.8부터 `local_credential`에서 읽고 쓰므로 V2.7 DB에서는 시작하지 않는다(계획 0096).
 * `email_verification_token`(019)은 이메일 인증 기능(계획 0096 BE 2단계)이 쓰기 시작할 때 확인에 더한다.
 * `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES`는 V2.6부터 쓰지 않아 확인하지 않는다(DB에는 남겨 둠).
 */
@Component
public class SchemaVerifier implements ApplicationRunner {
	static final List<String> TABLES = List.of(
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
		"user_consent",
		"refresh_token",
		"social_identity",
		"password_reset_token",
		"local_credential");
	/** V2.0(CR-04)·V2.1에서 지운 테이블. 하나라도 있으면 DB를 다시 만들지 않은 것이다. */
	static final List<String> RETIRED = List.of(
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
	/** V2.4에서 지운 컬럼. 남아 있으면 V2.3 이하 DB다(마이그레이션 없이 다시 만든다). */
	static final List<String> RETIRED_COLUMNS = List.of("feature_archive.row_count");
	/** 안내 문구: 운영 DB(V2.7)는 migration으로 올리고, 그보다 오래된 DB는 다시 만든다. */
	private static final String HOW = " (V2.7 DB: apply migrations 018 and 019; V2.6 or older DB: rebuild it with"
		+ " schema_V2_8.sql, database/README.md)";

	private final JdbcTemplate jdbc;

	public SchemaVerifier(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 테이블과 필요한 컬럼을 확인한다. 기본 정책은 가입 때 값 조합으로 찾는다. */
	@Override
	public void run(ApplicationArguments arguments) {
		// Windows MySQL(lower_case_table_names=1)은 테이블 이름을 소문자로 보여 준다.
		var present = new HashSet<String>();
		for (var table : jdbc.queryForList(
			"SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()",
			String.class)) {
			present.add(table.toLowerCase(Locale.ROOT));
		}
		var missing = TABLES.stream().filter(table -> !present.contains(table.toLowerCase(Locale.ROOT))).toList();
		if (!missing.isEmpty()) {
			throw new IllegalStateException("database schema V2.8 is not applied; missing " + missing + HOW);
		}
		var retired = RETIRED.stream().filter(table -> present.contains(table.toLowerCase(Locale.ROOT))).toList();
		if (!retired.isEmpty()) {
			throw new IllegalStateException(
				"database has tables removed in V2.0/V2.1 " + retired + "; rebuild it (database/README.md)");
		}
		for (var required : List.of(
			"baseline_posture.baseline_posture_id", "baseline_posture.registered_at", "baseline_posture.nose_x",
			"baseline_posture.client_registration_uuid",
			"monitor_session.baseline_posture_id", "user_account.sound_alert_enabled",
			"daily_stat.min_until_collapse_sec", "daily_stat.max_until_collapse_sec",
			"user_consent.document_version", "correction_alert.attempted_at",
			"refresh_token.token_hash", "refresh_token.rotated_at", "refresh_token.revoked_at",
			"social_identity.provider_subject", "password_reset_token.consumed_at",
			"local_credential.password_hash")) {
			var parts = required.split("\\.");
			if (!hasColumn(parts[0], parts[1])) {
				throw new IllegalStateException("database schema V2.8 is not applied; missing " + required + HOW);
			}
		}
		for (var removed : RETIRED_COLUMNS) {
			var parts = removed.split("\\.");
			if (hasColumn(parts[0], parts[1])) {
				throw new IllegalStateException(
					"database schema V2.8 is not applied; " + removed
						+ " was removed in V2.4; rebuild it with schema_V2_8.sql (database/README.md)");
			}
		}
	}

	private boolean hasColumn(String table, String column) {
		Integer count = jdbc.queryForObject(
			"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()"
				+ " AND table_name=? AND column_name=?",
			Integer.class,
			table,
			column);
		return count != null && count > 0;
	}
}
