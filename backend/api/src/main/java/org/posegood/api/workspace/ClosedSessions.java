package org.posegood.api.workspace;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.posegood.api.contract.SessionView;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.posegood.api.session.BaselineRepository;
import org.posegood.api.session.EndedSessionViews;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 끝난 세션을 DB에서 읽어 세션 결과로 다시 만든다. 기록 목록(R1)과 세션 상태 조회(S4, BE-11)가 같이 쓴다.
 *
 * 읽는 테이블: `monitor_session`, `collapse_event`, `correction_alert`, `excluded_interval`,
 * `threshold_policy`(database/README.md, V2.1).
 */
@Component
class ClosedSessions implements EndedSessionViews {
	private static final String OWNED_CLOSED = " JOIN monitor_session m ON m.monitor_session_id=x.monitor_session_id"
		+ " WHERE m.user_account_id=? AND m.ended_at IS NOT NULL";
	private static final String ONE = " AND m.client_session_uuid=?";

	private final JdbcTemplate jdbc;

	ClosedSessions(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** DB에서 읽은 끝난 세션 하나. {@code view}는 종료 저장이 실패한 세션(`ERROR`)이면 null. */
	record Closed(
		UUID id,
		UUID calibration,
		LocalDateTime startedAt,
		LocalDateTime endedAt,
		String endReason,
		ThresholdPolicyRepository.Values rules,
		SessionView view) {
	}

	@Override
	public SessionView find(long owner, UUID id) {
		var found = load(owner, id);
		return found.isEmpty() ? null : found.get(0).view();
	}

	/** 사용자의 끝난 세션(최신순). {@code only}가 있으면 그 세션만. 세션·알림·사건·제외 구간을 한꺼번에 읽는다. */
	List<Closed> load(long owner, UUID only) {
		String filter = only == null ? "" : ONE;
		Object[] args = only == null ? new Object[] {owner} : new Object[] {owner, only.toString()};
		var rows = jdbc.query(
			"SELECT m.monitor_session_id,m.client_session_uuid,m.baseline_posture_id,"
				+ "m.started_at,m.ended_at,CASE WHEN EXISTS (SELECT 1 FROM excluded_interval lost"
				+ " WHERE lost.monitor_session_id=m.monitor_session_id AND lost.exclusion_reason='MISSING'"
				+ " AND lost.started_at=m.started_at AND lost.ended_at=m.ended_at)"
				+ " THEN 'ERROR' ELSE 'STORED' END,m.good_sec,p.threshold,"
				+ "p.hold_seconds,p.recover_seconds,p.realert_seconds"
				+ " FROM monitor_session m JOIN threshold_policy p ON"
				+ " p.threshold_policy_id=m.threshold_policy_id WHERE m.user_account_id=?"
				+ " AND m.ended_at IS NOT NULL" + filter + " ORDER BY m.started_at DESC,"
				+ "m.monitor_session_id DESC",
			(row, n) -> new Session(
				row.getLong(1),
				UUID.fromString(row.getString(2)),
				BaselineRepository.publicId(owner, row.getLong(3)),
				row.getObject(4, LocalDateTime.class),
				row.getObject(5, LocalDateTime.class),
				row.getString(6),
				row.getBigDecimal(7).movePointRight(3).longValue(),
				new ThresholdPolicyRepository.Values(
					row.getBigDecimal(8),
					row.getBigDecimal(9),
					row.getBigDecimal(10),
					row.getInt(11))),
			args);
		if (rows.isEmpty()) {
			return List.of();
		}
		var starts = new HashMap<Long, LocalDateTime>();
		for (var session : rows) {
			starts.put(session.key(), session.startedAt());
		}
		var alerts = new HashMap<Long, Map<Integer, List<Long>>>();
		jdbc.query(
			"SELECT x.monitor_session_id,x.event_seq,x.attempted_at FROM correction_alert x"
				+ OWNED_CLOSED + filter
				+ " ORDER BY x.monitor_session_id,x.event_seq,x.attempted_at",
			row -> {
				long key = row.getLong(1);
				alerts.computeIfAbsent(key, k -> new HashMap<>())
					.computeIfAbsent(row.getInt(2), k -> new ArrayList<>())
					.add(elapsed(starts.get(key), row.getObject(3, LocalDateTime.class)));
			},
			args);
		var episodes = new HashMap<Long, List<RecordRebuild.Episode>>();
		jdbc.query(
			"SELECT x.monitor_session_id,x.event_seq,x.started_at,x.confirmed_at,x.ended_at,"
				+ "CASE WHEN x.recovered_at IS NOT NULL THEN 'RECOVERED'"
				+ " WHEN x.ended_at=m.ended_at THEN 'SESSION_END' ELSE 'EXCLUDED' END FROM collapse_event x"
				+ OWNED_CLOSED + filter
				+ " ORDER BY x.monitor_session_id,x.event_seq",
			row -> {
				long key = row.getLong(1);
				var start = starts.get(key);
				var ended = row.getObject(5, LocalDateTime.class);
				episodes.computeIfAbsent(key, k -> new ArrayList<>())
					.add(
						new RecordRebuild.Episode(
							elapsed(start, row.getObject(3, LocalDateTime.class)),
							elapsed(start, row.getObject(4, LocalDateTime.class)),
							ended == null ? null : elapsed(start, ended),
							row.getString(6),
							alerts.getOrDefault(key, Map.of())
								.getOrDefault(row.getInt(2), List.of())));
			},
			args);
		var spans = new HashMap<Long, List<RecordRebuild.Span>>();
		jdbc.query(
			"SELECT x.monitor_session_id,x.started_at,x.ended_at,x.exclusion_reason FROM"
				+ " excluded_interval x"
				+ OWNED_CLOSED + filter
				+ " ORDER BY x.monitor_session_id,x.started_at",
			row -> {
				long key = row.getLong(1);
				var start = starts.get(key);
				var from = row.getObject(2, LocalDateTime.class);
				var to = row.getObject(3, LocalDateTime.class);
				spans.computeIfAbsent(key, k -> new ArrayList<>())
					.add(
						new RecordRebuild.Span(
							elapsed(start, from),
							elapsed(start, to == null ? from : to),
							row.getString(4)));
			},
			args);

		var closed = new ArrayList<Closed>(rows.size());
		for (var session : rows) {
			var view = "ERROR".equals(session.endReason())
				? null
				: RecordRebuild.view(
					session.id(),
					session.rules().policy(),
					elapsed(session.startedAt(), session.endedAt()),
					session.goodMs(),
					episodes.getOrDefault(session.key(), List.of()),
					spans.getOrDefault(session.key(), List.of()));
			closed.add(
				new Closed(
					session.id(),
					session.calibration(),
					session.startedAt(),
					session.endedAt(),
					session.endReason(),
					session.rules(),
					view));
		}
		return closed;
	}

	private static long elapsed(LocalDateTime start, LocalDateTime at) {
		return Duration.between(start, at).toMillis();
	}

	private record Session(
		long key,
		UUID id,
		UUID calibration,
		LocalDateTime startedAt,
		LocalDateTime endedAt,
		String endReason,
		long goodMs,
		ThresholdPolicyRepository.Values rules) {
	}
}
