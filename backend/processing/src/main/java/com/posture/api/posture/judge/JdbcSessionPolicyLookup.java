package com.posture.api.posture.judge;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * (D-105) {@link SessionPolicyLookup}의 JDBC 구현 — 판정 결과 저장(D-30)과 같은 연결 풀로 서비스 DB를 읽기만 한다.
 * 판정기를 새로 만들 때 세션당 한 번 부르므로 관측마다 DB를 읽지 않는다. 판정 스레드가 오래 막히지 않게 2초 제한.
 */
@Component
class JdbcSessionPolicyLookup implements SessionPolicyLookup {

	private static final Pattern SCHEMA_NAME = Pattern.compile("[A-Za-z0-9_]{1,64}");
	static final int QUERY_TIMEOUT_SECONDS = 2;

	private final JdbcTemplate jdbc;
	private final String sql;

	JdbcSessionPolicyLookup(JdbcTemplate jdbc,
		@Value("${service-db.schema:posture_service}")
		String schema) {
		if (schema == null || !SCHEMA_NAME.matcher(schema).matches()) {
			throw new IllegalArgumentException("service-db.schema가 올바르지 않음: " + schema);
		}
		this.jdbc = new JdbcTemplate(jdbc.getDataSource());
		this.jdbc.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
		this.sql = "SELECT p.threshold, p.hold_seconds, p.recover_seconds, p.realert_seconds"
			+ " FROM `" + schema + "`.monitor_session s"
			+ " JOIN `" + schema + "`.threshold_policy p ON p.threshold_policy_id = s.threshold_policy_id"
			+ " WHERE s.client_session_uuid = ?";
	}

	@Override
	public Optional<JudgePolicy> find(String sessionId) {
		List<Map<String, Object>> rows = jdbc.queryForList(sql, sessionId);
		return rows.isEmpty() ? Optional.empty() : Optional.of(toPolicy(rows.get(0)));
	}

	/** DB 값(초, DECIMAL) → 판정 정책(ms). 재알림은 정수 초. */
	static JudgePolicy toPolicy(Map<String, Object> row) {
		return new JudgePolicy(
			millis(row.get("hold_seconds")),
			millis(row.get("recover_seconds")),
			millis(row.get("realert_seconds")),
			((Number)row.get("threshold")).doubleValue());
	}

	private static long millis(Object seconds) {
		BigDecimal value = seconds instanceof BigDecimal d ? d : new BigDecimal(seconds.toString());
		return value.movePointRight(3).longValueExact();
	}
}
