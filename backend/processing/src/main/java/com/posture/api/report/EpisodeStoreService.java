package com.posture.api.report;

import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * (D-30, D-51) 판정 결과(decision) 하나를 V2.3 결과 테이블에 반영한다.
 *
 * <p>DB 제약(DB 회신 C-1~C-4, 10/10 사용자 결정 "BE는 DB 제약을 지킴"):
 * <ul>
 *   <li>세션 행은 만들지 않는다 — 입출구 서버가 만든 행을 {@code client_session_uuid}로 찾는다(C-2). 없으면 건너뛰고 센다.</li>
 *   <li>세션 종료 값({@code ended_at}·{@code good_sec})은 여기서만 쓴다(C-1). V2.3은 종료 방식(사용자 종료·끊김·오류)을 구분하지 않는다.</li>
 *   <li>순번은 같은 메시지에서 늘 같은 값(C-3): 붕괴 순번은 같은 시작 시각의 기존 행 순번, 없으면 최대 + 1.
 *       알림 행은 (세션, 순번, 시각)이 PK라 같은 시각의 행이 있으면 건너뛴다. Kafka가 다시 보내도 같은 행을 찾는다.</li>
 *   <li>이벤트 종료 사유는 V2.3에서 시각으로 판정한다(회복 = {@code recovered_at} 있음, 세션 종료 = 세션 {@code ended_at}과 같음,
 *       그 밖 = 제외 구간 중단).</li>
 *   <li>(D-39) 제외 구간(C-4): {@code excluded_started}에 행을 열고(종료 NULL), {@code excluded_ended}에 닫는다.
 *       시작 시각(PK)으로 찾으므로 재전송에도 같은 행이다. 세션 종료 때 열린 구간이 남아 있으면 닫는다.</li>
 *   <li>알림: V2.3은 알림이 꺼져 있어도 첫 알림·재알림 시점을 기록하고, 표시 여부는 세션 {@code alert_enabled}로 판단한다
 *       (시간당 상한·억제 사유 없음).</li>
 *   <li>(D-54) 알림 발행: 알림 행을 <b>새로</b> 넣었고, 세션 알림이 켜져 있고({@code alert_enabled}), decision이 판정에서 나온 지
 *       {@code report.alerts.max-age-ms}(기본 10초) 안이면 {@code posture.alerts.v1}로 낸다. 재전송(행이 이미 있음)·알림 꺼짐·
 *       오래된 사건(재처리·밀림)은 내지 않는다 — 앱에 늦은 알림이 뜨지 않게. DB 기록이 먼저이고, 발행 실패는 기록을 되돌리지 않는다.</li>
 * </ul>
 *
 * <p>여러 SQL을 트랜잭션으로 묶지 않는다. 각 단계가 멱등이라 중간에 실패해 다시 받아도 남은 단계만 채워진다.
 * DB 오류는 그대로 던진다 — 호출하는 쪽(컨슈머)이 제약 위반은 DLQ로, 장애는 재시도로 나눈다.
 */
@Component
public class EpisodeStoreService {

	private static final Logger log = LoggerFactory.getLogger(EpisodeStoreService.class);
	private static final int WARNED_LIMIT = 1000;

	/** 반영 결과 */
	public enum Outcome {
		STORED, DUPLICATE, SESSION_NOT_FOUND, EVENT_NOT_FOUND
	}

	private final EpisodeStore store;
	private final AlertPublisher alerts;
	private final boolean alertsEnabled;
	private final Duration alertMaxAge;
	private final Supplier<Instant> clock;
	private final AtomicLong alertsPublished = new AtomicLong();
	private final AtomicLong alertsSkippedOff = new AtomicLong();
	private final AtomicLong alertsSkippedStale = new AtomicLong();
	private final AtomicLong stored = new AtomicLong();
	private final AtomicLong duplicates = new AtomicLong();
	private final AtomicLong sessionNotFound = new AtomicLong();
	private final AtomicLong eventNotFound = new AtomicLong();
	private final AtomicLong eventsInserted = new AtomicLong();
	private final AtomicLong alertsInserted = new AtomicLong();
	private final AtomicLong alertsWhileOff = new AtomicLong();
	private final AtomicLong sessionsEnded = new AtomicLong();
	private final AtomicLong excludedWritten = new AtomicLong();
	private final AtomicReference<String> lastStoredAt = new AtomicReference<>();
	private final Set<String> warnedSessions = Collections.newSetFromMap(new ConcurrentHashMap<>());

	@Autowired
	public EpisodeStoreService(EpisodeStore store, AlertPublisher alerts,
		@Value("${report.alerts.enabled:true}")
		boolean alertsEnabled,
		@Value("${report.alerts.max-age-ms:10000}")
		long alertMaxAgeMs) {
		this(store, alerts, alertsEnabled, alertMaxAgeMs, Instant::now);
	}

	/** 시험용: 알림 발행 없이. */
	EpisodeStoreService(EpisodeStore store) {
		this(store, AlertPublisher.NO_OP, false, 10_000, Instant::now);
	}

	EpisodeStoreService(EpisodeStore store, AlertPublisher alerts, boolean alertsEnabled, long alertMaxAgeMs,
		Supplier<Instant> clock) {
		this.store = store;
		this.alerts = alerts;
		this.alertsEnabled = alertsEnabled;
		this.alertMaxAge = Duration.ofMillis(alertMaxAgeMs);
		this.clock = clock;
	}

	public Outcome apply(EpisodeDecision decision) {
		SessionRow session = store.findSession(decision.sessionId()).orElse(null);
		if (session == null) {
			sessionNotFound.incrementAndGet();
			if (warnedSessions.size() < WARNED_LIMIT && warnedSessions.add(decision.sessionId())) {
				log.warn("판정 결과 저장: monitor_session 없음 — 건너뜀 (client_session_uuid={}, 입구 API가 세션 행을 만들어야 함)",
					decision.sessionId());
			}
			return Outcome.SESSION_NOT_FOUND;
		}
		Outcome outcome = switch (decision.kind()) {
			case "collapse_confirmed" -> confirm(session, decision);
			case "reminder" -> remind(session, decision);
			case "recovery_confirmed" -> endEvent(session, decision, true);
			case "interrupted" -> endEvent(session, decision, false);
			case "session_ended" -> endSession(session, decision);
			case "excluded_started" -> startExcluded(session, decision);
			case "excluded_ended" -> endExcluded(session, decision);
			default -> throw new IllegalArgumentException("모르는 사건 종류: " + decision.kind());
		};
		switch (outcome) {
			case STORED -> {
				stored.incrementAndGet();
				lastStoredAt.set(Instant.now().toString());
			}
			case DUPLICATE -> duplicates.incrementAndGet();
			case EVENT_NOT_FOUND -> {
				eventNotFound.incrementAndGet();
				log.warn("판정 결과 저장: 이벤트 없음 — {} 건너뜀 (session={}, onset_ms={}, event_id={})",
					decision.kind(), decision.sessionId(), decision.onsetMs(), decision.eventId());
			}
			default -> {
			}
		}
		return outcome;
	}

	/** 붕괴 확정: 이벤트 행 + 알림 시도 1. */
	private Outcome confirm(SessionRow session, EpisodeDecision decision) {
		OptionalInt seq = store.eventSeqByStart(session.id(), decision.onsetMs());
		boolean inserted = false;
		int eventSeq;
		if (seq.isPresent()) {
			eventSeq = seq.getAsInt();
		} else {
			eventSeq = store.maxEventSeq(session.id()) + 1;
			store.insertEvent(session.id(), eventSeq, decision.onsetMs(), decision.timestampMs());
			eventsInserted.incrementAndGet();
			inserted = true;
		}
		boolean alert = alert(session, eventSeq, decision);
		return inserted || alert ? Outcome.STORED : Outcome.DUPLICATE;
	}

	/** 재알림: 다음 알림 시도. */
	private Outcome remind(SessionRow session, EpisodeDecision decision) {
		OptionalInt seq = store.eventSeqByStart(session.id(), decision.onsetMs());
		if (seq.isEmpty()) {
			return Outcome.EVENT_NOT_FOUND;
		}
		return alert(session, seq.getAsInt(), decision) ? Outcome.STORED : Outcome.DUPLICATE;
	}

	/** @return 새로 넣었으면 true */
	private boolean alert(SessionRow session, int eventSeq, EpisodeDecision decision) {
		long atMs = decision.timestampMs();
		if (store.alertExists(session.id(), eventSeq, atMs)) {
			return false;
		}
		store.insertAlert(session.id(), eventSeq, atMs);
		alertsInserted.incrementAndGet();
		if (!session.alertEnabled()) {
			alertsWhileOff.incrementAndGet();
			alertsSkippedOff.incrementAndGet();
		} else if (alertsEnabled) {
			publishIfFresh(decision);
		}
		return true;
	}

	/** (D-54) 판정이 낸 지 max-age 안이면 발행. produced_at이 없으면(옛 메시지·시험) 새것으로 본다. */
	private void publishIfFresh(EpisodeDecision decision) {
		Instant now = clock.get();
		if (decision.producedAt() != null && Duration.between(decision.producedAt(), now).compareTo(alertMaxAge) > 0) {
			alertsSkippedStale.incrementAndGet();
			log.info("알림 발행 안 함 — 오래된 사건 (session={}, event_id={}, produced_at={})",
				decision.sessionId(), decision.eventId(), decision.producedAt());
			return;
		}
		alerts.publish(decision);
		alertsPublished.incrementAndGet();
	}

	private Outcome endEvent(SessionRow session, EpisodeDecision decision, boolean recovered) {
		OptionalInt seq = store.eventSeqByStart(session.id(), decision.onsetMs());
		if (seq.isEmpty()) {
			return Outcome.EVENT_NOT_FOUND;
		}
		return store.endEvent(session.id(), seq.getAsInt(), decision.timestampMs(), recovered)
			? Outcome.STORED : Outcome.DUPLICATE;
	}

	private Outcome endSession(SessionRow session, EpisodeDecision decision) {
		// 판정기는 세션 종료 전에 진행 중 사건을 interrupted(ended)로 닫는다. 그래도 열린 이벤트가 있으면(앞 메시지 유실) 닫는다(BR-12).
		int closed = store.endOpenEvents(session.id(), decision.timestampMs());
		closed += store.endOpenExcluded(session.id(), decision.timestampMs());
		boolean ended = store.endSession(session.id(), decision.timestampMs(), decision.normalMs());
		if (ended) {
			sessionsEnded.incrementAndGet();
		}
		return ended || closed > 0 ? Outcome.STORED : Outcome.DUPLICATE;
	}

	/** (D-39) 제외 구간 시작: 종료 시각 없이 행을 연다. */
	private Outcome startExcluded(SessionRow session, EpisodeDecision decision) {
		boolean inserted = store.startExcluded(session.id(), decision.onsetMs(), exclusion(decision));
		if (inserted) {
			excludedWritten.incrementAndGet();
		}
		return inserted ? Outcome.STORED : Outcome.DUPLICATE;
	}

	/** (D-39) 제외 구간 끝: 열린 행을 닫는다(행이 없으면 시작·끝을 함께 넣는다). */
	private Outcome endExcluded(SessionRow session, EpisodeDecision decision) {
		boolean changed = store.endExcluded(session.id(), decision.onsetMs(), decision.timestampMs(),
			exclusion(decision));
		if (changed) {
			excludedWritten.incrementAndGet();
		}
		return changed ? Outcome.STORED : Outcome.DUPLICATE;
	}

	private static String exclusion(EpisodeDecision decision) {
		String reason = EpisodeDecision.EXCLUSION_REASONS.get(decision.reason());
		if (reason == null) {
			throw new IllegalArgumentException("제외 구간 사유 오류: " + decision.reason());
		}
		return reason;
	}

	public Map<String, Object> status() {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("stored", stored.get());
		status.put("duplicates", duplicates.get());
		status.put("sessionNotFound", sessionNotFound.get());
		status.put("eventNotFound", eventNotFound.get());
		status.put("eventsInserted", eventsInserted.get());
		status.put("alertsInserted", alertsInserted.get());
		status.put("alertsWhileOff", alertsWhileOff.get());
		status.put("alertsPublished", alertsPublished.get());
		status.put("alertsSkippedOff", alertsSkippedOff.get());
		status.put("alertsSkippedStale", alertsSkippedStale.get());
		status.put("alertsPublishEnabled", alertsEnabled);
		status.put("sessionsEnded", sessionsEnded.get());
		status.put("excludedWritten", excludedWritten.get());
		status.put("lastStoredAt", lastStoredAt.get());
		return status;
	}
}
