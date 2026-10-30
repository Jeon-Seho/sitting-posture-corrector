package com.posture.api.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** (D-54) 판정 결과 저장 → posture.alerts.v1: 알림 켜짐·새 알림 행·10초 안 사건만, 재전송은 다시 내지 않음. */
class AlertPublishTest {

	static final String SID = EpisodeStoreServiceTest.SID;
	static final Instant T0 = Instant.parse("2026-10-18T06:00:00Z");

	final FakeEpisodeStore store = new FakeEpisodeStore();
	final List<EpisodeDecision> published = new ArrayList<>();
	Instant now = T0.plusSeconds(1);
	final EpisodeStoreService service = new EpisodeStoreService(store, published::add, true, 10_000, () -> now);

	static EpisodeDecision decision(long eventId, String kind, long ts, long onset, Instant producedAt) {
		return new EpisodeDecision(SID, eventId, kind, ts, onset, null, 0, "u1", producedAt, "forward_slouch");
	}

	/** T-10: 확정·재알림 두 번 발행, 복귀·종료는 알림 아님. */
	@Test
	void confirmAndReminderArePublishedWhenAlertsOn() {
		store.addSession(SID, true);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		service.apply(decision(2, "reminder", 68000, 5000, T0));
		service.apply(decision(3, "recovery_confirmed", 78000, 5000, T0));
		service.apply(new EpisodeDecision(SID, 4, "session_ended", 85000, 85000, "ended", 15000, "u1", T0, "none"));
		assertThat(published).hasSize(2);
		assertThat(published.get(0).kind()).isEqualTo("collapse_confirmed");
		assertThat(published.get(1).kind()).isEqualTo("reminder");
		assertThat(service.status().get("alertsPublished")).isEqualTo(2L);
	}

	/** 재전송: 알림 행이 이미 있으면 다시 내지 않는다(앱에 같은 알림이 두 번 뜨지 않게). */
	@Test
	void redeliveryDoesNotPublishAgain() {
		store.addSession(SID, true);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		assertThat(published).hasSize(1);
	}

	/** 세션 알림이 꺼져 있으면 기록만 하고 내지 않는다(V2.3: 꺼져도 알림 시점은 기록). */
	@Test
	void alertsOffSessionIsRecordedButNotPublished() {
		store.addSession(SID, false);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		assertThat(store.alerts).hasSize(1);
		assertThat(published).isEmpty();
		assertThat(service.status().get("alertsSkippedOff")).isEqualTo(1L);
	}

	/** 판정에서 나온 지 10초가 넘은 사건(밀림·재처리)은 기록만. 경계 10초는 낸다. */
	@Test
	void staleDecisionIsRecordedButNotPublished() {
		store.addSession(SID, true);
		now = T0.plusMillis(10_001);
		service.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		assertThat(store.alerts).hasSize(1);
		assertThat(published).isEmpty();
		assertThat(service.status().get("alertsSkippedStale")).isEqualTo(1L);
		now = T0.plusMillis(10_000);
		service.apply(decision(2, "reminder", 68000, 5000, T0));
		assertThat(published).hasSize(1);
	}

	/** 발행을 끄면(report.alerts.enabled=false) 저장만 한다. */
	@Test
	void publishingCanBeDisabled() {
		EpisodeStoreService off = new EpisodeStoreService(store, published::add, false, 10_000, () -> now);
		store.addSession(SID, true);
		off.apply(decision(1, "collapse_confirmed", 8000, 5000, T0));
		assertThat(store.alerts).hasSize(1);
		assertThat(published).isEmpty();
	}

	/** 봉투의 user_id·produced_at·deviation_type을 읽는다. produced_at이 날짜가 아니면 DLQ. */
	@Test
	void envelopeValuesAreRead() {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("event", EpisodeStoreServiceTest.event("collapse_confirmed", 8000, 5000, null));
		Map<String, Object> envelope = EpisodeStoreServiceTest.envelope("decision", body);
		envelope.put("user_id", "u1");
		envelope.put("produced_at", "2026-10-18T06:00:00Z");
		EpisodeDecision decision = EpisodeDecision.fromEnvelope(envelope);
		assertThat(decision.userId()).isEqualTo("u1");
		assertThat(decision.producedAt()).isEqualTo(T0);
		assertThat(decision.deviationType()).isEqualTo("forward_slouch");
		envelope.put("produced_at", "yesterday");
		assertThat(EpisodeStoreServiceTest.rejects(envelope)).isTrue();
	}

	/** 발행 메시지 모양(계약 kafka-alerts.v1). */
	@Test
	@SuppressWarnings("unchecked")
	void messageMatchesContractShape() {
		Map<String, Object> message = KafkaAlertPublisher.message(decision(2, "reminder", 68000, 5000, T0),
			T0.plusSeconds(1));
		assertThat(message.get("schema_version")).isEqualTo("1.0");
		assertThat(message.get("kind")).isEqualTo("alert");
		assertThat(message.get("session_id")).isEqualTo(SID);
		assertThat(message.get("user_id")).isEqualTo("u1");
		assertThat(message.get("produced_at")).isEqualTo("2026-10-18T06:00:01Z");
		Map<String, Object> body = (Map<String, Object>)message.get("body");
		assertThat(body.get("event_id")).isEqualTo(2L);
		assertThat(body.get("kind")).isEqualTo("reminder");
		assertThat(body.get("deviation_type")).isEqualTo("forward_slouch");
		assertThat(body.get("timestamp_ms")).isEqualTo(68000L);
		assertThat(body.get("onset_ms")).isEqualTo(5000L);
	}
}
