package com.posture.api.posture.cep;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * (D-18) 판정 경로와 DB 쓰기를 분리하는 쓰기 버퍼.
 *
 * <p>기존에는 Kafka 컨슈머 스레드가 메시지마다 {@code sessions}를 upsert했다. 그래서
 * DB가 느리거나 끊기면(연결 대기 5초) 판정 전체가 멈추고, poll 제한 초과로 같은 묶음을
 * 계속 다시 받았다(T-11, 2026-10-07 비밀번호 오타 때 lag 848). v4 장애 격리 요구
 * ("MySQL이 멈춰도 진행 중 세션 판정은 계속")와도 어긋났다.
 *
 * <p>이제 컨슈머 스레드는 이 버퍼에 <b>메모리로만</b> 넘기고 바로 다음 메시지로 간다.
 * 별도 스레드({@code cep-db-writer})가 주기적으로(기본 1초) 모아서 한 번에 쓴다.
 * <ul>
 *   <li>sessions: 세션별로 합쳐 묶음당 1행 — 메시지당 DB 쓰기가 사라진다.</li>
 *   <li>collapse_events: (세션, 시작 시각)별 최신 상태만 남겨 쓴다(upsert라 결과 동일).</li>
 *   <li>DB 실패 시: 데이터를 버리지 않고 다시 보관한 뒤, 1초 → 2초 → … 최대 30초 간격으로 재시도.
 *       복구되면 보관분을 한 번에 기록한다.</li>
 *   <li>보관 한도: 이벤트는 {@code cep.db-writer.event-capacity}(기본 10000)까지. 넘치면 가장
 *       오래된 것부터 버리고 개수를 센다. 세션 요약은 세션 수만큼만 생기므로 한도가 필요 없다.</li>
 * </ul>
 */
@Component
public class CepWriteBuffer implements InitializingBean, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(CepWriteBuffer.class);

    private final CepWriteTarget target;
    private final long flushIntervalMs;
    private final int eventCapacity;
    private final long maxBackoffMs;
    private final LongSupplier clock;

    private final ConcurrentHashMap<String, SessionTouch> pendingSessions = new ConcurrentHashMap<>();
    private final LinkedHashMap<String, EventRow> pendingEvents = new LinkedHashMap<>();

    private final AtomicLong droppedEvents = new AtomicLong();
    private final AtomicLong writtenSessionRows = new AtomicLong();
    private final AtomicLong writtenEventRows = new AtomicLong();
    private volatile int consecutiveFailures;
    private volatile long nextAttemptAtMs;
    private volatile String lastError;
    private volatile Instant lastSuccessAt;
    private volatile Instant failingSince;

    private ScheduledExecutorService executor;

    @Autowired
    public CepWriteBuffer(
            CepJdbcRepository repository,
            @Value("${cep.db-writer.flush-interval-ms:1000}") long flushIntervalMs,
            @Value("${cep.db-writer.event-capacity:10000}") int eventCapacity,
            @Value("${cep.db-writer.max-backoff-ms:30000}") long maxBackoffMs) {
        this(repository, flushIntervalMs, eventCapacity, maxBackoffMs, System::currentTimeMillis);
    }

    CepWriteBuffer(CepWriteTarget target, long flushIntervalMs, int eventCapacity, long maxBackoffMs,
                   LongSupplier clock) {
        this.target = target;
        this.flushIntervalMs = Math.max(100, flushIntervalMs);
        this.eventCapacity = Math.max(1, eventCapacity);
        this.maxBackoffMs = Math.max(this.flushIntervalMs, maxBackoffMs);
        this.clock = clock;
    }

    // ------------------------------------------------------------------
    // 판정 경로에서 부르는 메서드 — DB를 건드리지 않고 메모리에만 넣는다.
    // ------------------------------------------------------------------

    /** 샘플 1건(매 메시지). 같은 세션은 하나로 합쳐진다. */
    public void recordSample(InferenceEvent event) {
        if (event.sessionId() == null) {
            return;
        }
        Instant at;
        try {
            at = Instant.parse(event.capturedAt());
        } catch (Exception exc) {
            log.warn("capturedAt을 파싱할 수 없어 세션 기록을 건너뜀 (sessionId={}): {}",
                    event.sessionId(), exc.getMessage());
            return;
        }
        SessionTouch touch = SessionTouch.of(event.sessionId(), event.userId(), at);
        pendingSessions.merge(event.sessionId(), touch, SessionTouch::merge);
    }

    /** 붕괴 이벤트 상태 전환(시작·재알림·종료). 값은 지금 시점으로 복사해 둔다. */
    public void recordEvent(CepOutcome outcome) {
        offerEvent(EventRow.from(outcome));
    }

    void offerEvent(EventRow row) {
        synchronized (pendingEvents) {
            pendingEvents.remove(row.key());          // 같은 이벤트의 이전 상태는 버리고
            pendingEvents.put(row.key(), row);        // 최신 상태를 맨 뒤에 둔다
            trimEventsLocked();
        }
    }

    private void trimEventsLocked() {
        Iterator<Map.Entry<String, EventRow>> it = pendingEvents.entrySet().iterator();
        while (pendingEvents.size() > eventCapacity && it.hasNext()) {
            it.next();
            it.remove();
            long dropped = droppedEvents.incrementAndGet();
            if (dropped == 1 || dropped % 1000 == 0) {
                log.warn("DB 쓰기 보관 한도({}건) 초과 — 가장 오래된 붕괴 이벤트 기록을 버림 (누적 {}건)",
                        eventCapacity, dropped);
            }
        }
    }

    // ------------------------------------------------------------------
    // 쓰기 스레드
    // ------------------------------------------------------------------

    @Override
    public void afterPropertiesSet() {
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cep-db-writer");
            t.setDaemon(true);
            return t;
        });
        executor.scheduleWithFixedDelay(this::flushSafely, flushIntervalMs, flushIntervalMs, TimeUnit.MILLISECONDS);
        log.info("DB 쓰기 버퍼 시작 (주기 {}ms, 이벤트 보관 한도 {}건, 최대 재시도 간격 {}ms)",
                flushIntervalMs, eventCapacity, maxBackoffMs);
    }

    @Override
    public void destroy() {
        if (executor != null) {
            executor.shutdown();
            try {
                executor.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
            }
        }
        nextAttemptAtMs = 0;           // 종료 직전에는 재시도 대기와 상관없이 한 번 더 쓴다
        flushSafely();
        int left = pendingSessions.size() + pendingEventCount();
        if (left > 0) {
            log.warn("종료 시점에 DB에 쓰지 못한 기록 {}건이 남음 (세션 {}, 이벤트 {})",
                    left, pendingSessions.size(), pendingEventCount());
        }
    }

    private void flushSafely() {
        try {
            flush();
        } catch (Throwable t) {
            log.error("DB 쓰기 버퍼 처리 중 예상하지 못한 오류 (다음 주기에 계속)", t);
        }
    }

    /**
     * 모아 둔 쓰기를 DB에 반영한다. 재시도 대기 중이면 아무것도 하지 않는다.
     *
     * @return 이번에 실제로 쓰기를 시도했으면 true
     */
    boolean flush() {
        long now = clock.getAsLong();
        if (now < nextAttemptAtMs) {
            return false;
        }
        List<SessionTouch> sessions = drainSessions();
        List<EventRow> events = drainEvents();
        if (sessions.isEmpty() && events.isEmpty()) {
            return false;
        }

        boolean sessionsOk = true;
        boolean eventsOk = true;
        String error = null;
        if (!sessions.isEmpty()) {
            try {
                target.upsertSessions(sessions);
                writtenSessionRows.addAndGet(sessions.size());
            } catch (Exception exc) {
                sessionsOk = false;
                error = exc.getMessage();
                requeueSessions(sessions);
            }
        }
        if (!events.isEmpty()) {
            if (!sessionsOk) {
                eventsOk = false;            // 같은 DB가 실패 중이면 시도하지 않고 바로 보관
                requeueEvents(events);
            } else {
                try {
                    target.upsertEvents(events);
                    writtenEventRows.addAndGet(events.size());
                } catch (Exception exc) {
                    eventsOk = false;
                    error = exc.getMessage();
                    requeueEvents(events);
                }
            }
        }

        if (sessionsOk && eventsOk) {
            if (consecutiveFailures > 0) {
                log.info("DB 쓰기 재개 — 보관했던 기록을 반영함 (세션 {}행, 이벤트 {}행, 실패 지속 {}초)",
                        sessions.size(), events.size(),
                        failingSince != null ? (now - failingSince.toEpochMilli()) / 1000 : 0);
            }
            consecutiveFailures = 0;
            nextAttemptAtMs = 0;
            failingSince = null;
            lastError = null;
            lastSuccessAt = Instant.ofEpochMilli(now);
        } else {
            int failures = ++consecutiveFailures;
            if (failingSince == null) {
                failingSince = Instant.ofEpochMilli(now);
            }
            long backoff = Math.min(maxBackoffMs, flushIntervalMs * (1L << Math.min(failures - 1, 16)));
            nextAttemptAtMs = now + backoff;
            lastError = error;
            log.warn("DB 쓰기 실패 {}회째 — 판정은 계속, 기록은 보관 후 {}ms 뒤 재시도 (보관: 세션 {}, 이벤트 {}): {}",
                    failures, backoff, pendingSessions.size(), pendingEventCount(), error);
        }
        return true;
    }

    private List<SessionTouch> drainSessions() {
        List<SessionTouch> out = new ArrayList<>();
        for (String key : pendingSessions.keySet()) {
            SessionTouch t = pendingSessions.remove(key);
            if (t != null) {
                out.add(t);
            }
        }
        return out;
    }

    private void requeueSessions(List<SessionTouch> sessions) {
        for (SessionTouch t : sessions) {
            pendingSessions.merge(t.sessionId(), t, SessionTouch::merge);
        }
    }

    private List<EventRow> drainEvents() {
        synchronized (pendingEvents) {
            List<EventRow> out = new ArrayList<>(pendingEvents.values());
            pendingEvents.clear();
            return out;
        }
    }

    /** 실패한 묶음을 되돌린다. 그 사이 같은 이벤트의 더 새 상태가 들어왔으면 그것을 유지한다. */
    private void requeueEvents(List<EventRow> events) {
        synchronized (pendingEvents) {
            LinkedHashMap<String, EventRow> merged = new LinkedHashMap<>();
            for (EventRow row : events) {
                merged.put(row.key(), row);
            }
            for (Map.Entry<String, EventRow> e : pendingEvents.entrySet()) {
                merged.remove(e.getKey());
                merged.put(e.getKey(), e.getValue());
            }
            pendingEvents.clear();
            pendingEvents.putAll(merged);
            trimEventsLocked();
        }
    }

    private int pendingEventCount() {
        synchronized (pendingEvents) {
            return pendingEvents.size();
        }
    }

    /** 관리 API(/cep/db-writer)용 상태. */
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pendingSessions", pendingSessions.size());
        m.put("pendingEvents", pendingEventCount());
        m.put("droppedEvents", droppedEvents.get());
        m.put("writtenSessionRows", writtenSessionRows.get());
        m.put("writtenEventRows", writtenEventRows.get());
        m.put("consecutiveFailures", consecutiveFailures);
        m.put("failingSince", failingSince != null ? failingSince.toString() : null);
        m.put("lastSuccessAt", lastSuccessAt != null ? lastSuccessAt.toString() : null);
        m.put("lastError", lastError);
        return m;
    }
}
