package org.posegood.api.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.posegood.api.contract.SessionView.DecisionEvent;

/**
 * 판정 사건 기록장: 사건을 쌓고 붕괴 수·알림 수·평균 간격·평균 회복 시간을 센다.
 *
 * 통계는 유효 시간 축에서 계산한다.
 */
final class EpisodeLedger {
	private final UUID sessionId;
	private final List<DecisionEvent> events = new ArrayList<>();
	private Episode active;
	private Long previousOnsetValid;
	private long eventId;
	private long collapseCount;
	private long alerts;
	private long intervals;
	private long intervalSum;
	private long recoveries;
	private long recoverySum;

	EpisodeLedger(UUID sessionId) {
		this.sessionId = sessionId;
	}

	boolean active() {
		return active != null;
	}

	long sinceAlertMs(long at) {
		return active == null ? 0 : at - active.lastAlert;
	}

	/** 붕괴 확정(첫 알림 포함). */
	void confirmCollapse(long at, long onset, long onsetValid, String type) {
		active = new Episode(onset, onsetValid, at, type);
		collapseCount++;
		alerts++;
		if (previousOnsetValid != null) {
			intervals++;
			intervalSum += onsetValid - previousOnsetValid;
		}
		previousOnsetValid = onsetValid;
		emit("collapse_confirmed", at, active, null);
	}

	/** 재알림. */
	void remind(long at) {
		alerts++;
		active.lastAlert = at;
		emit("reminder", at, active, null);
	}

	/** 회복 확정. */
	void confirmRecovery(long at) {
		recoveries++;
		recoverySum += at - active.firstAlert;
		emit("recovery_confirmed", at, active, null);
		active = null;
	}

	/**
	 * 중단: 열린 사건을 회복으로 세지 않고 끝낸다.
	 */
	void interrupt(String reason, long at) {
		if (active != null) {
			emit("interrupted", at, active, reason);
		}
		active = null;
	}

	/** 세션 종료 사건. */
	void end(long at, long validMs) {
		events.add(
			new DecisionEvent(
				"1.0", sessionId, ++eventId, "session_ended", at, at, validMs, "none",
				"ended"));
	}

	int size() {
		return events.size();
	}

	List<DecisionEvent> events() {
		return List.copyOf(events);
	}

	DecisionEvent event(int index) {
		return events.get(index);
	}

	Statistics statistics() {
		return new Statistics(
			collapseCount,
			alerts,
			intervals,
			intervals == 0 ? null : (double)intervalSum / intervals,
			recoveries == 0 ? null : (double)recoverySum / recoveries);
	}

	private void emit(String kind, long at, Episode episode, String reason) {
		events.add(
			new DecisionEvent(
				"1.0",
				sessionId,
				++eventId,
				kind,
				at,
				episode.onset,
				episode.onsetValid,
				episode.type,
				reason));
	}

	record Statistics(
		long collapseCount,
		long alertCount,
		long intervalCount,
		Double meanIntervalMs,
		Double meanRecoveryMs) {
	}

	private static final class Episode {
		private final long onset;
		private final long onsetValid;
		private final long firstAlert;
		private final String type;
		private long lastAlert;

		private Episode(long onset, long onsetValid, long at, String type) {
			this.onset = onset;
			this.onsetValid = onsetValid;
			this.firstAlert = at;
			this.lastAlert = at;
			this.type = type;
		}
	}
}
