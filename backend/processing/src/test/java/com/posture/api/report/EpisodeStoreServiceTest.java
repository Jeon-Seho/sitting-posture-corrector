package com.posture.api.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.posture.api.report.EpisodeStoreService.Outcome;

/** (D-30, D-51) 판정 결과 저장(DB V2.3) — DB 제약(C-1·C-3), 재전송 멱등, 알림 기록, 시각으로 판정하는 종료 사유. */
class EpisodeStoreServiceTest {

	static final String SID = "11111111-2222-3333-4444-555555555555";

	final FakeEpisodeStore store = new FakeEpisodeStore();
	final EpisodeStoreService service = new EpisodeStoreService(store);

	static EpisodeDecision decision(long eventId, String kind, long ts, long onset, String reason, long normal) {
		return new EpisodeDecision(SID, eventId, kind, ts, onset, reason, normal);
	}

	/** T-10 v1 시나리오(DN-39): 시작 5.0s → 확정 8.0s → 재알림 68.0s → 복귀 78.0s → 종료 85.0s, normal 15000. */
	static List<EpisodeDecision> t10() {
		List<EpisodeDecision> decisions = new ArrayList<>();
		decisions.add(decision(1, "collapse_confirmed", 8000, 5000, null, 3000));
		decisions.add(decision(2, "reminder", 68000, 5000, null, 5000));
		decisions.add(decision(3, "recovery_confirmed", 78000, 5000, null, 5000));
		decisions.add(decision(4, "session_ended", 85000, 85000, "ended", 15000));
		return decisions;
	}

	@Test
	void t10ScenarioIsStored() {
		store.addSession(SID, true);
		for (EpisodeDecision x : t10()) {
			assertThat(service.apply(x)).isEqualTo(Outcome.STORED);
		}
		assertThat(store.events).hasSize(1);
		FakeEpisodeStore.Ev event = store.events.get(0);
		assertThat(event.seq).isEqualTo(1);
		assertThat(event.started).isEqualTo(5000L);
		assertThat(event.confirmed).isEqualTo(8000L);
		assertThat(event.ended).isEqualTo(78000L);
		assertThat(event.recovered).isEqualTo(78000L);
		assertThat(store.alerts).hasSize(2);
		assertThat(store.alerts.get(0).at).isEqualTo(8000L);
		assertThat(store.alerts.get(1).at).isEqualTo(68000L);
		assertThat(store.sessionEndedMs).isEqualTo(85000L);
		assertThat(store.goodMs).isEqualTo(15000L);
		assertThat(store.endKind(event)).isEqualTo("RECOVERED");
	}

	/** C-3: Kafka 재전송 — 같은 메시지를 다시 받아도 행이 늘지 않고 순번이 같다. */
	@Test
	void redeliveryIsIdempotent() {
		store.addSession(SID, true);
		for (EpisodeDecision x : t10()) {
			service.apply(x);
		}
		int writes = store.writes;
		for (EpisodeDecision x : t10()) {
			assertThat(service.apply(x)).isEqualTo(Outcome.DUPLICATE);
		}
		assertThat(store.writes).isEqualTo(writes);
		assertThat(store.events).hasSize(1);
		assertThat(store.alerts).hasSize(2);
		assertThat(service.status().get("duplicates")).isEqualTo(4L);
	}

	/** 두 번째 붕괴는 순번 2. 첫 사건의 확정 메시지를 나중에 다시 받아도 순번 1로 찾는다. */
	@Test
	void sequenceComesFromStartTimeNotCounter() {
		store.addSession(SID, true);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0));
		service.apply(decision(2, "recovery_confirmed", 20000, 5000, null, 0));
		service.apply(decision(3, "collapse_confirmed", 40000, 37000, null, 0));
		assertThat(store.events).hasSize(2);
		assertThat(store.events.get(1).seq).isEqualTo(2);
		assertThat(service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0))).isEqualTo(Outcome.DUPLICATE);
		assertThat(store.events).hasSize(2);
		assertThat(store.alerts).hasSize(2);
		assertThat(store.alerts.get(1).eventSeq).isEqualTo(2);
		assertThat(store.alerts.get(1).at).isEqualTo(40000L);
	}

	/** V2.3: 알림이 꺼진 세션도 첫 알림·재알림 시점을 기록한다(표시 여부는 세션 alert_enabled로 판단). 시간당 상한은 없다. */
	@Test
	void alertsAreRecordedEvenWhenAlertsAreOff() {
		store.addSession(SID, false);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0));
		service.apply(decision(2, "reminder", 68000, 5000, null, 0));
		service.apply(decision(3, "reminder", 128000, 5000, null, 0));
		assertThat(store.events).hasSize(1);
		assertThat(store.alerts).hasSize(3);
		assertThat(service.status().get("alertsWhileOff")).isEqualTo(3L);
	}

	/** 끊김(누락·판정 불가·rest·away)은 그 시각에 닫고 회복 시각 없음 → EXCLUDED, 세션 종료와 같은 시각이면 SESSION_END. 만료도 종료 값을 채운다. */
	@Test
	void interruptionAndExpiryAreJudgedByTime() {
		store.addSession(SID, true);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0));
		service.apply(decision(2, "interrupted", 30000, 5000, "missing", 0));
		assertThat(store.events.get(0).ended).isEqualTo(30000L);
		assertThat(store.events.get(0).recovered).isNull();
		service.apply(decision(3, "collapse_confirmed", 50000, 46000, null, 0));
		service.apply(decision(4, "interrupted", 60000, 46000, "ended", 0));
		service.apply(decision(5, "session_ended", 60000, 60000, "missing", 9000));
		assertThat(store.endKind(store.events.get(0))).isEqualTo("EXCLUDED");
		assertThat(store.endKind(store.events.get(1))).isEqualTo("SESSION_END");
		assertThat(store.sessionEndedMs).isEqualTo(60000L);
		assertThat(store.goodMs).isEqualTo(9000L);
	}

	/** 앞 메시지가 빠져 이벤트가 열려 있어도 세션 종료 때 SESSION_END로 닫는다(BR-12). 종료 시각은 확정 이후로. */
	@Test
	void sessionEndClosesOpenEvents() {
		store.addSession(SID, true);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0));
		service.apply(decision(2, "session_ended", 6000, 6000, "ended", 1000));
		assertThat(store.events.get(0).ended).isEqualTo(8000L);
		assertThat(store.events.get(0).recovered).isNull();
		assertThat(store.sessionEndedMs).isEqualTo(6000L);
	}

	/** (D-39) 제외 구간: 시작에 열고 끝에 닫는다, 사유는 DB 값으로, 재전송은 그대로, 시작이 빠져도 끝에서 넣는다. */
	@Test
	void excludedIntervalsAreOpenedAndClosed() {
		store.addSession(SID, true);
		assertThat(service.apply(decision(1, "excluded_started", 6000, 6000, "rest", 0))).isEqualTo(Outcome.STORED);
		assertThat(store.excluded).hasSize(1);
		assertThat(store.excluded.get(0).ended).isNull();
		assertThat(store.excluded.get(0).reason).isEqualTo("PAUSE");
		assertThat(service.apply(decision(2, "excluded_ended", 8500, 6000, "rest", 0))).isEqualTo(Outcome.STORED);
		assertThat(store.excluded.get(0).ended).isEqualTo(8500L);
		int writes = store.writes;
		assertThat(service.apply(decision(1, "excluded_started", 6000, 6000, "rest", 0))).isEqualTo(Outcome.DUPLICATE);
		assertThat(service.apply(decision(2, "excluded_ended", 8500, 6000, "rest", 0))).isEqualTo(Outcome.DUPLICATE);
		assertThat(store.writes).isEqualTo(writes);
		// 시작 메시지가 빠진 구간은 끝 메시지에서 시작·끝을 함께 넣는다
		assertThat(service.apply(decision(4, "excluded_ended", 9500, 8500, "away", 0))).isEqualTo(Outcome.STORED);
		assertThat(store.excluded.get(1).started).isEqualTo(8500L);
		assertThat(store.excluded.get(1).ended).isEqualTo(9500L);
		assertThat(store.excluded.get(1).reason).isEqualTo("ABSENCE");
		assertThat(service.status().get("excludedWritten")).isEqualTo(3L);
	}

	/** (D-39) 세션 종료 때 열린 제외 구간을 종료 시각으로 닫는다(끝 메시지가 빠진 경우). */
	@Test
	void sessionEndClosesOpenExcludedIntervals() {
		store.addSession(SID, true);
		service.apply(decision(1, "excluded_started", 27000, 27000, "missing", 0));
		assertThat(service.apply(decision(2, "session_ended", 29500, 29500, "ended", 0))).isEqualTo(Outcome.STORED);
		assertThat(store.excluded.get(0).ended).isEqualTo(29500L);
		assertThat(store.excluded.get(0).reason).isEqualTo("MISSING");
	}

	@Test
	void missingSessionAndOrphanEventsAreSkipped() {
		assertThat(service.apply(decision(1, "collapse_confirmed", 8000, 5000, null, 0)))
			.isEqualTo(Outcome.SESSION_NOT_FOUND);
		assertThat(store.writes).isEqualTo(0);
		store.addSession(SID, true);
		assertThat(service.apply(decision(2, "reminder", 68000, 5000, null, 0))).isEqualTo(Outcome.EVENT_NOT_FOUND);
		assertThat(service.apply(decision(3, "recovery_confirmed", 78000, 5000, null, 0)))
			.isEqualTo(Outcome.EVENT_NOT_FOUND);
		assertThat(store.writes).isEqualTo(0);
		Map<String, Object> st = service.status();
		assertThat(st.get("sessionNotFound")).isEqualTo(1L);
		assertThat(st.get("eventNotFound")).isEqualTo(2L);
	}

	// --- 메시지 해석 ---

	static Map<String, Object> envelope(String kind, Map<String, Object> body) {
		Map<String, Object> envelope = new LinkedHashMap<>();
		envelope.put("schema_version", "1.0");
		envelope.put("session_id", SID);
		envelope.put("kind", kind);
		envelope.put("body", body);
		return envelope;
	}

	static Map<String, Object> event(String kind, long ts, long onset, String reason) {
		Map<String, Object> event = new LinkedHashMap<>();
		event.put("schema_version", "1.0");
		event.put("session_id", SID);
		event.put("event_id", 1L);
		event.put("kind", kind);
		event.put("timestamp_ms", ts);
		event.put("onset_ms", onset);
		event.put("onset_valid_ms", onset);
		event.put("deviation_type", "forward_slouch");
		event.put("reason", reason);
		return event;
	}

	@Test
	void decisionIsParsedFromEnvelope() {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("last_sequence", 169L);
		body.put("event", event("session_ended", 85000, 85000, "ended"));
		body.put("summary", Map.of("normal_ms", 15000L, "valid_ms", 85000L));
		EpisodeDecision decision = EpisodeDecision.fromEnvelope(envelope("decision", body));
		assertThat(decision.kind()).isEqualTo("session_ended");
		assertThat(decision.timestampMs()).isEqualTo(85000L);
		assertThat(decision.reason()).isEqualTo("ended");
		assertThat(decision.normalMs()).isEqualTo(15000L);
		assertThat(EpisodeDecision.fromEnvelope(envelope("progress", Map.of("summary", Map.of())))).isNull();
	}

	@Test
	void badDecisionsAreRejectedForDlq() {
		assertThat(rejects(envelope("other", Map.of()))).isTrue();
		assertThat(rejects(envelope("decision", Map.of()))).isTrue();
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("event", event("reminder", 5000, 8000, null)); // onset > timestamp
		assertThat(rejects(envelope("decision", body))).isTrue();
		Map<String, Object> wrongKind = new LinkedHashMap<>();
		wrongKind.put("event", event("teleport", 5000, 1000, null));
		assertThat(rejects(envelope("decision", wrongKind))).isTrue();
		Map<String, Object> envelope = envelope("decision", Map.of());
		envelope.put("session_id", "short");
		assertThat(rejects(envelope)).isTrue();
		Map<String, Object> badExclusion = new LinkedHashMap<>();
		badExclusion.put("event", event("excluded_started", 1000, 1000, "ended")); // (D-39) 제외 사유가 아님
		assertThat(rejects(envelope("decision", badExclusion))).isTrue();
		Map<String, Object> goodExclusion = new LinkedHashMap<>();
		goodExclusion.put("event", event("excluded_ended", 2000, 1000, "unmeasurable"));
		assertThat(rejects(envelope("decision", goodExclusion))).isFalse();
	}

	static boolean rejects(Map<String, Object> envelope) {
		try {
			EpisodeDecision.fromEnvelope(envelope);
			return false;
		} catch (IllegalArgumentException exc) {
			return true;
		}
	}
}
