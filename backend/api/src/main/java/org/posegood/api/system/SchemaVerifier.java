package org.posegood.api.system;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 시작할 때 DB V2.6의 저장 계약을 확인한다.
 *
 * API는 테이블을 만들거나 고치지 않는다. 스키마와 시드는 DB 담당 절차로 적용한다
 * (V2.6 → V2.7은 마이그레이션 017. V2.5 이전 DB는 마이그레이션 없이 `schema_V2_7.sql`로 다시 만든다).
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
		"refresh_token");
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

	private final JdbcTemplate jdbc;
	private final boolean discord;
	private final boolean passwordReset;

	public SchemaVerifier(
		JdbcTemplate jdbc,
		@Value("${posegood.auth.discord.client-id:}")
		String discordClientId,
		@Value("${posegood.auth.password-reset.enabled:false}")
		boolean passwordReset) {
		this.jdbc = jdbc;
		this.discord = !discordClientId.isBlank();
		this.passwordReset = passwordReset;
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
			throw new IllegalStateException("database schema V2.6 is not applied; missing " + missing
				+ " (V2.5 or older DB: rebuild it with schema_V2_7.sql, database/README.md)");
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
			"refresh_token.token_hash", "refresh_token.rotated_at", "refresh_token.revoked_at")) {
			var parts = required.split("\\.");
			if (!hasColumn(parts[0], parts[1])) {
				throw new IllegalStateException("database schema V2.6 is not applied; missing " + required
					+ " (V2.5 or older DB: rebuild it with schema_V2_7.sql, database/README.md)");
			}
		}
		// 켠 기능의 표만 확인한다(제안 V2.7, DB 담당 적용 전에는 기능을 끈 채로 둔다).
		var optional = new java.util.ArrayList<String>();
		if (discord) {
			optional.add("social_identity.provider_subject");
		}
		if (passwordReset) {
			optional.add("password_reset_token.consumed_at");
		}
		for (var required : optional) {
			var parts = required.split("\\.");
			if (!hasColumn(parts[0], parts[1])) {
				throw new IllegalStateException("the enabled login feature needs " + required
					+ " (proposed V2.7, docs/design/social-login-password-reset-handoff.md)");
			}
		}
		for (var removed : RETIRED_COLUMNS) {
			var parts = removed.split("\\.");
			if (hasColumn(parts[0], parts[1])) {
				throw new IllegalStateException(
					"database schema V2.6 is not applied; " + removed
						+ " was removed in V2.4; rebuild it with schema_V2_7.sql (database/README.md)");
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
