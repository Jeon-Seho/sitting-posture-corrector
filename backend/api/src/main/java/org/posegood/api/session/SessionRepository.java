package org.posegood.api.session;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.engine.ExcludedSpan;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** DB V2.3 session/event storage. Mutations run inside the caller's transaction. */
@Repository("monitorSessionRepository")
public class SessionRepository {
	private static final String SESSION = "SELECT m.*,p.threshold,p.hold_seconds,p.recover_seconds,p.realert_seconds,"
		+ "(SELECT COUNT(*) FROM collapse_event e WHERE e.monitor_session_id=m.monitor_session_id) AS collapse_count,"
		+ "(SELECT COUNT(*) FROM correction_alert a WHERE a.monitor_session_id=m.monitor_session_id) AS alert_count"
		+ " FROM monitor_session m JOIN threshold_policy p ON p.threshold_policy_id=m.threshold_policy_id";
	private final JdbcTemplate jdbc;

	public SessionRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public Stored find(UUID id) {
		var rows = jdbc.query(SESSION + " WHERE m.client_session_uuid=?", this::stored, id.toString());
		return rows.isEmpty() ? null : rows.get(0);
	}

	public void insert(long owner, UUID id, long policy, long baseline, boolean alerts, LocalDateTime at) {
		jdbc.update("INSERT INTO monitor_session(client_session_uuid,user_account_id,baseline_posture_id,"
			+ "threshold_policy_id,alert_enabled,started_at) VALUES(?,?,?,?,?,?)",
			id.toString(), owner, baseline, policy, alerts, at);
	}

	/** Midnight rollover: a new row with the previous session's user, baseline, policy and alert setting. */
	public void insertFollowing(Stored previous, UUID id, LocalDateTime at) {
		jdbc.update("INSERT INTO monitor_session(client_session_uuid,user_account_id,baseline_posture_id,"
			+ "threshold_policy_id,alert_enabled,started_at) SELECT ?,user_account_id,baseline_posture_id,"
			+ "threshold_policy_id,alert_enabled,? FROM monitor_session WHERE monitor_session_id=?",
			id.toString(), at, previous.key());
	}

	public void applyEvent(Stored session, DecisionEvent event, int episode) {
		var at = at(session, event.timestampMs());
		switch (event.kind()) {
			case "collapse_confirmed" -> {
				jdbc.update(
					"INSERT INTO collapse_event(monitor_session_id,event_seq,started_at,confirmed_at) VALUES(?,?,?,?)",
					session.key(), episode, at(session, event.onsetMs()), at);
				alert(session, episode, at);
			}
			case "reminder" -> alert(session, episode, at);
			case "recovery_confirmed" -> jdbc.update(
				"UPDATE collapse_event SET ended_at=?,recovered_at=? WHERE monitor_session_id=? AND event_seq=?",
				at, at, session.key(), episode);
			case "interrupted" -> jdbc.update(
				"UPDATE collapse_event SET ended_at=? WHERE monitor_session_id=? AND event_seq=?",
				at, session.key(), episode);
			case "session_ended" -> {
			}
			default -> throw new IllegalStateException("unknown decision kind");
		}
	}

	/**
	 * Ends once and stores exclusions. `daily_stat` is not touched here: Spark J2 (cron daily 00:00)
	 * aggregates the previous KST day from the result tables (architecture v5.2).
	 */
	public boolean close(Stored session, Closing closing) {
		int closed = jdbc.update(
			"UPDATE monitor_session SET ended_at=?,good_sec=? WHERE monitor_session_id=? AND ended_at IS NULL",
			at(session, closing.totalMs()), tenths(closing.normalMs()), session.key());
		if (closed != 1) {
			return false;
		}
		for (var span : closing.excluded()) {
			jdbc.update(
				"INSERT INTO excluded_interval(monitor_session_id,started_at,ended_at,exclusion_reason)"
					+ " VALUES(?,?,?,?)",
				session.key(), at(session, span.startMs()), at(session, span.endMs()), span.reason().name());
		}

		return true;
	}

	public void delete(Stored session) {
		try {
			jdbc.update("DELETE FROM monitor_session WHERE monitor_session_id=?", session.key());
		} catch (DataIntegrityViolationException archived) {
			throw ApiError.conflict("session has archived feature files");
		}
	}

	private void alert(Stored session, int episode, LocalDateTime at) {
		jdbc.update("INSERT INTO correction_alert(monitor_session_id,event_seq,attempted_at) VALUES(?,?,?)",
			session.key(), episode, at);
	}

	private static LocalDateTime at(Stored session, long elapsedMs) {
		return KstTime.of(session.startedAt().plusMillis(elapsedMs));
	}

	static BigDecimal tenths(long ms) {
		return BigDecimal.valueOf(ms, 3).setScale(1, RoundingMode.DOWN);
	}

	private Stored stored(ResultSet row, int rowNumber) throws SQLException {
		long owner = row.getLong("user_account_id");
		var policy = new ThresholdPolicyRepository.Values(row.getBigDecimal("threshold"),
			row.getBigDecimal("hold_seconds"),
			row.getBigDecimal("recover_seconds"), row.getInt("realert_seconds")).policy();
		return new Stored(row.getLong("monitor_session_id"), UUID.fromString(row.getString("client_session_uuid")),
			owner, policy,
			BaselineRepository.publicId(owner, row.getLong("baseline_posture_id")), row.getBoolean("alert_enabled"),
			KstTime.read(row, "started_at"), KstTime.read(row, "ended_at"), row.getBigDecimal("good_sec"),
			row.getLong("collapse_count"), row.getLong("alert_count"));
	}

	public record Stored(long key, UUID id, long owner, Policy policy, UUID baselineId, boolean alertEnabled,
		Instant startedAt, Instant endedAt, BigDecimal goodSec, long collapseCount, long alertCount) {
	}
	public record Closing(long totalMs, long normalMs, List<ExcludedSpan> excluded) {
	}
}
