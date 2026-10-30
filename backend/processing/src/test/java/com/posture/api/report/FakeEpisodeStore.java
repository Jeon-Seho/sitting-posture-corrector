package com.posture.api.report;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/** (D-30, D-51) JdbcEpisodeStore(V2.3)의 SQL 의미를 메모리로 흉내 낸 것 — 시각은 세션 시작 기준 ms. */
class FakeEpisodeStore implements EpisodeStore {

	static final class Ev {
		int seq;
		long started;
		long confirmed;
		Long ended;
		Long recovered;
	}

	static final class Al {
		int eventSeq;
		long at;
	}

	/** (D-39) excluded_interval 행: PK (세션, 시작 시각) */
	static final class Ex {
		long started;
		Long ended;
		String reason;
	}

	final Map<String, SessionRow> sessions = new HashMap<>();
	final List<Ex> excluded = new ArrayList<>();
	final List<Ev> events = new ArrayList<>();
	final List<Al> alerts = new ArrayList<>();
	Long sessionEndedMs;
	Long goodMs;
	int writes;

	void addSession(String uuid, boolean alertEnabled) {
		sessions.put(uuid, new SessionRow(1L, alertEnabled, false));
	}

	@Override
	public Optional<SessionRow> findSession(String clientSessionUuid) {
		return Optional.ofNullable(sessions.get(clientSessionUuid));
	}

	@Override
	public OptionalInt eventSeqByStart(long sessionId, long startedMs) {
		return events.stream().filter(e -> e.started == startedMs).mapToInt(e -> e.seq).findFirst();
	}

	@Override
	public int maxEventSeq(long sessionId) {
		return events.stream().mapToInt(e -> e.seq).max().orElse(0);
	}

	@Override
	public void insertEvent(long sessionId, int eventSeq, long startedMs, long confirmedMs) {
		if (events.stream().anyMatch(e -> e.seq == eventSeq)) {
			throw new IllegalStateException("PK 중복 event_seq=" + eventSeq);
		}
		Ev event = new Ev();
		event.seq = eventSeq;
		event.started = startedMs;
		event.confirmed = Math.max(startedMs, confirmedMs);
		events.add(event);
		writes++;
	}

	@Override
	public boolean endEvent(long sessionId, int eventSeq, long endedMs, boolean recovered) {
		for (Ev e : events) {
			if (e.seq == eventSeq && e.ended == null) {
				e.ended = Math.max(endedMs, e.confirmed);
				e.recovered = recovered ? e.ended : null;
				writes++;
				return true;
			}
		}
		return false;
	}

	@Override
	public int endOpenEvents(long sessionId, long endedMs) {
		int closedCount = 0;
		for (Ev e : events) {
			if (e.ended == null) {
				e.ended = Math.max(endedMs, e.confirmed);
				closedCount++;
				writes++;
			}
		}
		return closedCount;
	}

	@Override
	public boolean alertExists(long sessionId, int eventSeq, long attemptedMs) {
		return alerts.stream().anyMatch(a -> a.eventSeq == eventSeq && a.at == attemptedMs);
	}

	@Override
	public void insertAlert(long sessionId, int eventSeq, long attemptedMs) {
		if (alertExists(sessionId, eventSeq, attemptedMs)) {
			throw new IllegalStateException("PK 중복 (event_seq, attempted_at)=" + eventSeq + ", " + attemptedMs);
		}
		if (events.stream().noneMatch(e -> e.seq == eventSeq)) {
			throw new IllegalStateException("FK-16 이벤트 없음 event_seq=" + eventSeq);
		}
		Al alert = new Al();
		alert.eventSeq = eventSeq;
		alert.at = attemptedMs;
		alerts.add(alert);
		writes++;
	}

	@Override
	public boolean endSession(long sessionId, long endedMs, long goodMs) {
		if (sessionEndedMs != null) {
			return false;
		}
		sessionEndedMs = endedMs;
		this.goodMs = goodMs;
		writes++;
		return true;
	}

	@Override
	public boolean startExcluded(long sessionId, long startedMs, String reason) {
		if (excluded.stream().anyMatch(x -> x.started == startedMs)) {
			return false;
		}
		Ex interval = new Ex();
		interval.started = startedMs;
		interval.reason = reason;
		excluded.add(interval);
		writes++;
		return true;
	}

	@Override
	public boolean endExcluded(long sessionId, long startedMs, long endedMs, String reason) {
		for (Ex x : excluded) {
			if (x.started == startedMs) {
				if (x.ended != null) {
					return false;
				}
				x.ended = Math.max(startedMs, endedMs);
				writes++;
				return true;
			}
		}
		Ex interval = new Ex();
		interval.started = startedMs;
		interval.ended = Math.max(startedMs, endedMs);
		interval.reason = reason;
		excluded.add(interval);
		writes++;
		return true;
	}

	@Override
	public int endOpenExcluded(long sessionId, long endedMs) {
		int closedCount = 0;
		for (Ex x : excluded) {
			if (x.ended == null) {
				x.ended = Math.max(x.started, endedMs);
				closedCount++;
				writes++;
			}
		}
		return closedCount;
	}

	/** V2.3: 종료 사유 컬럼 없이 시각으로 판정(JdbcEpisodeStore.sessionView의 end_kind와 같은 규칙). */
	String endKind(Ev event) {
		if (event.recovered != null) {
			return "RECOVERED";
		}
		if (event.ended == null) {
			return null;
		}
		return event.ended.equals(sessionEndedMs) ? "SESSION_END" : "EXCLUDED";
	}

	@Override
	public Optional<Map<String, Object>> sessionView(String clientSessionUuid) {
		return Optional.empty();
	}
}
