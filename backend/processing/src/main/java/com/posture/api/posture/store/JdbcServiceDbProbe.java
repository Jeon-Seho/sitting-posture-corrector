package com.posture.api.posture.store;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * (D-32) 기존 연결 풀(JdbcTemplate)로 같은 MySQL 서버의 서비스 DB를 조회한다.
 *
 * <p>(D-38) 연결 풀의 기본 DB가 확정 {@code posture_service}다(옛 테스트용 {@code posture_app} 접속은 지움). 조회는 계속
 * 스키마 이름을 붙여 한다(같은 계정에 {@code posture_service.*} 권한 필요). 스키마 이름은 {@link ServiceSchemaVerifier}가
 * 영문·숫자·밑줄만 허용한 값이다.
 */
@Component
class JdbcServiceDbProbe implements ServiceDbProbe {

	private final JdbcTemplate jdbc;

	JdbcServiceDbProbe(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public List<String> tables(String schema) {
		return jdbc.queryForList(
			"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
			String.class, schema);
	}

	@Override
	public List<String> columns(String schema, String table) {
		return jdbc.queryForList(
			"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
			String.class, schema, table);
	}

	@Override
	public Optional<Long> policyIdByValues(String schema, DefaultPolicy policy) {
		List<Long> ids = jdbc.queryForList(
			"SELECT threshold_policy_id FROM `" + schema + "`.threshold_policy"
				+ " WHERE threshold = ? AND hold_seconds = ? AND recover_seconds = ? AND realert_seconds = ?",
			Long.class, policy.threshold(), policy.holdSeconds(), policy.recoverSeconds(), policy.realertSeconds());
		return ids.isEmpty() ? Optional.empty() : Optional.ofNullable(ids.get(0));
	}

	@Override
	public List<String> privileges(String schema) {
		// information_schema의 권한 표는 지금 접속한 계정의 권한만 보여 준다.
		List<String> privileges = new ArrayList<>(jdbc.queryForList(
			"SELECT PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA = ?",
			String.class, schema));
		privileges.addAll(jdbc.queryForList("SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES",
			String.class));
		return privileges;
	}
}
