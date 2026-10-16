package com.posture.api.report;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

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
 *       그 밖 = 제외 구간 중단). 제외 구간 행(C-4)은 계약에 경계가 생긴 뒤(D-39) 붙인다.</li>
 *   <li>알림: V2.3은 알림이 꺼져 있어도 첫 알림·재알림 시점을 기록하고, 표시 여부는 세션 {@code alert_enabled}로 판단한다
 *       (시간당 상한·억제 사유 없음).</li>
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
    public enum Outcome { STORED, DUPLICATE, SESSION_NOT_FOUND, EVENT_NOT_FOUND }

    private final EpisodeStore store;
    private final AtomicLong stored = new AtomicLong();
    private final AtomicLong duplicates = new AtomicLong();
    private final AtomicLong sessionNotFound = new AtomicLong();
    private final AtomicLong eventNotFound = new AtomicLong();
    private final AtomicLong eventsInserted = new AtomicLong();
    private final AtomicLong alertsInserted = new AtomicLong();
    private final AtomicLong alertsWhileOff = new AtomicLong();
    private final AtomicLong sessionsEnded = new AtomicLong();
    private final AtomicReference<String> lastStoredAt = new AtomicReference<>();
    private final Set<String> warnedSessions = Collections.newSetFromMap(new ConcurrentHashMap<>());

    public EpisodeStoreService(EpisodeStore store) {
        this.store = store;
    }

    public Outcome apply(EpisodeDecision d) {
        SessionRow s = store.findSession(d.sessionId()).orElse(null);
        if (s == null) {
            sessionNotFound.incrementAndGet();
            if (warnedSessions.size() < WARNED_LIMIT && warnedSessions.add(d.sessionId())) {
                log.warn("판정 결과 저장: monitor_session 없음 — 건너뜀 (client_session_uuid={}, 입구 API가 세션 행을 만들어야 함)",
                        d.sessionId());
            }
            return Outcome.SESSION_NOT_FOUND;
        }
        Outcome o = switch (d.kind()) {
            case "collapse_confirmed" -> confirm(s, d);
            case "reminder" -> remind(s, d);
            case "recovery_confirmed" -> endEvent(s, d, true);
            case "interrupted" -> endEvent(s, d, false);
            case "session_ended" -> endSession(s, d);
            default -> throw new IllegalArgumentException("모르는 사건 종류: " + d.kind());
        };
        switch (o) {
            case STORED -> {
                stored.incrementAndGet();
                lastStoredAt.set(Instant.now().toString());
            }
            case DUPLICATE -> duplicates.incrementAndGet();
            case EVENT_NOT_FOUND -> {
                eventNotFound.incrementAndGet();
                log.warn("판정 결과 저장: 이벤트 없음 — {} 건너뜀 (session={}, onset_ms={}, event_id={})",
                        d.kind(), d.sessionId(), d.onsetMs(), d.eventId());
            }
            default -> { }
        }
        return o;
    }

    /** 붕괴 확정: 이벤트 행 + 알림 시도 1. */
    private Outcome confirm(SessionRow s, EpisodeDecision d) {
        OptionalInt seq = store.eventSeqByStart(s.id(), d.onsetMs());
        boolean inserted = false;
        int eventSeq;
        if (seq.isPresent()) {
            eventSeq = seq.getAsInt();
        } else {
            eventSeq = store.maxEventSeq(s.id()) + 1;
            store.insertEvent(s.id(), eventSeq, d.onsetMs(), d.timestampMs());
            eventsInserted.incrementAndGet();
            inserted = true;
        }
        boolean alert = alert(s, eventSeq, d.timestampMs());
        return inserted || alert ? Outcome.STORED : Outcome.DUPLICATE;
    }

    /** 재알림: 다음 알림 시도. */
    private Outcome remind(SessionRow s, EpisodeDecision d) {
        OptionalInt seq = store.eventSeqByStart(s.id(), d.onsetMs());
        if (seq.isEmpty()) {
            return Outcome.EVENT_NOT_FOUND;
        }
        return alert(s, seq.getAsInt(), d.timestampMs()) ? Outcome.STORED : Outcome.DUPLICATE;
    }

    /** @return 새로 넣었으면 true */
    private boolean alert(SessionRow s, int eventSeq, long atMs) {
        if (store.alertExists(s.id(), eventSeq, atMs)) {
            return false;
        }
        store.insertAlert(s.id(), eventSeq, atMs);
        alertsInserted.incrementAndGet();
        if (!s.alertEnabled()) {
            alertsWhileOff.incrementAndGet();
        }
        return true;
    }

    private Outcome endEvent(SessionRow s, EpisodeDecision d, boolean recovered) {
        OptionalInt seq = store.eventSeqByStart(s.id(), d.onsetMs());
        if (seq.isEmpty()) {
            return Outcome.EVENT_NOT_FOUND;
        }
        return store.endEvent(s.id(), seq.getAsInt(), d.timestampMs(), recovered)
                ? Outcome.STORED : Outcome.DUPLICATE;
    }

    private Outcome endSession(SessionRow s, EpisodeDecision d) {
        // 판정기는 세션 종료 전에 진행 중 사건을 interrupted(ended)로 닫는다. 그래도 열린 이벤트가 있으면(앞 메시지 유실) 닫는다(BR-12).
        int closed = store.endOpenEvents(s.id(), d.timestampMs());
        boolean ended = store.endSession(s.id(), d.timestampMs(), d.normalMs());
        if (ended) {
            sessionsEnded.incrementAndGet();
        }
        return ended || closed > 0 ? Outcome.STORED : Outcome.DUPLICATE;
    }

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("stored", stored.get());
        m.put("duplicates", duplicates.get());
        m.put("sessionNotFound", sessionNotFound.get());
        m.put("eventNotFound", eventNotFound.get());
        m.put("eventsInserted", eventsInserted.get());
        m.put("alertsInserted", alertsInserted.get());
        m.put("alertsWhileOff", alertsWhileOff.get());
        m.put("sessionsEnded", sessionsEnded.get());
        m.put("lastStoredAt", lastStoredAt.get());
        return m;
    }
}
