package org.posegood.api.workspace;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.posegood.api.session.BaselineRepository;
import org.posegood.api.session.SessionService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

/**
 * 기록 목록 조회: 닫힌 세션들을 DB에서 읽어 앱 기록 형식으로 만든다.
 *
 * 읽는 테이블: `monitor_session`, `collapse_event`, `correction_alert`, `excluded_interval`,
 * `threshold_policy`(database/README.md, V2.1).
 */
@Component
class RecordHistory {
	private static final String OWNED_CLOSED = " JOIN monitor_session m ON m.monitor_session_id=x.monitor_session_id"
		+ " WHERE m.user_account_id=? AND m.ended_at IS NOT NULL";

	private final JdbcTemplate jdbc;
	private final Json json;
	private final SessionService sessions;

	RecordHistory(JdbcTemplate jdbc, Json json, SessionService sessions) {
		this.jdbc = jdbc;
		this.json = json;
		this.sessions = sessions;
	}

	/** 사용자의 기록 목록(최신순). 세션·알림·사건·제외 구간을 한꺼번에 읽는다. */
	List<JsonNode> list(long owner) {
		var rows = jdbc.query(
			"SELECT m.monitor_session_id,m.client_session_uuid,m.baseline_posture_id,"
				+ "m.started_at,m.ended_at,CASE WHEN EXISTS (SELECT 1 FROM excluded_interval lost"
				+ " WHERE lost.monitor_session_id=m.monitor_session_id AND lost.exclusion_reason='MISSING'"
				+ " AND lost.started_at=m.started_at AND lost.ended_at=m.ended_at)"
				+ " THEN 'ERROR' ELSE 'STORED' END,m.good_sec,p.threshold,"
				+ "p.hold_seconds,p.recover_seconds,p.realert_seconds"
				+ " FROM monitor_session m JOIN threshold_policy p ON"
				+ " p.threshold_policy_id=m.threshold_policy_id WHERE m.user_account_id=?"
				+ " AND m.ended_at IS NOT NULL ORDER BY m.started_at DESC,"
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
			owner);
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
				+ OWNED_CLOSED
				+ " ORDER BY x.monitor_session_id,x.event_seq,x.attempted_at",
			row -> {
				long key = row.getLong(1);
				alerts.computeIfAbsent(key, k -> new HashMap<>())
					.computeIfAbsent(row.getInt(2), k -> new ArrayList<>())
					.add(elapsed(starts.get(key), row.getObject(3, LocalDateTime.class)));
			},
			owner);
		var episodes = new HashMap<Long, List<RecordRebuild.Episode>>();
		jdbc.query(
			"SELECT x.monitor_session_id,x.event_seq,x.started_at,x.confirmed_at,x.ended_at,"
				+ "CASE WHEN x.recovered_at IS NOT NULL THEN 'RECOVERED'"
				+ " WHEN x.ended_at=m.ended_at THEN 'SESSION_END' ELSE 'EXCLUDED' END FROM collapse_event x"
				+ OWNED_CLOSED
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
			owner);
		var spans = new HashMap<Long, List<RecordRebuild.Span>>();
		jdbc.query(
			"SELECT x.monitor_session_id,x.started_at,x.ended_at,x.exclusion_reason FROM"
				+ " excluded_interval x"
				+ OWNED_CLOSED
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
			owner);

		String model = sessions.modelVersion();
		var records = new ArrayList<JsonNode>(rows.size());
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
			records.add(
				RecordRebuild.record(
					session.id().toString(),
					KstTime.instant(session.startedAt()).toString(),
					KstTime.instant(session.endedAt()).toString(),
					session.rules(),
					session.calibration(),
					session.endReason(),
					view,
					model,
					view == null ? null : json.tree(view)));
		}
		return records;
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
