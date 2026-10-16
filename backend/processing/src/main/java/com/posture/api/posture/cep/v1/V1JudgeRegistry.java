package com.posture.api.posture.cep.v1;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * (D-22) 세션별 v1 판정기 모음 — {@code posture.inference.v1}의 kind별 처리와 {@code posture.episodes.v1} 발행.
 *
 * <ul>
 *   <li>{@code session_started}: 정책으로 판정기를 만든다(이미 관측을 받은 세션이면 무시).</li>
 *   <li>{@code observation}: 판정기에 넣고 나온 decision들을 먼저, 그다음 progress를 발행한다.
 *       시작 메시지 없이 온 세션은 기본 정책으로 만든다.</li>
 *   <li>{@code session_ended}: 최종 decision(끊김·session_ended)과 progress를 발행하고 판정기를 정리한다.</li>
 *   <li>입력이 timeout 동안 없는 세션은 만료: 진행 중 사건만 끊김(missing)으로 닫고 정리한다.</li>
 * </ul>
 *
 * <p>판정은 DB에 쓰지 않는다(1차 회의 3번 — 저장은 결과를 받는 쪽, D-30).
 *
 * <p>(D-37) 판정 상태를 {@link V1JudgeStore}(Redis {@code posture:v1:judge:{session_id}})에 저장한다.
 * <ul>
 *   <li>저장: 세션 시작, 반영한 관측마다(발행 뒤). 컨슈머는 메시지 처리가 끝난 뒤 offset을 커밋하므로,
 *       재시작 뒤 다시 받는 메시지는 저장된 {@code last_sequence} 이하라 중복으로 건너뛴다 — 누락·이중 집계 없음.</li>
 *   <li>복원: 메모리에 없는 세션의 메시지가 오면 먼저 저장소를 본다(재시작 직후의 첫 메시지).</li>
 *   <li>삭제: 세션 종료·만료 때.</li>
 * </ul>
 */
@Component
public class V1JudgeRegistry {

    private static final Logger log = LoggerFactory.getLogger(V1JudgeRegistry.class);
    static final int RECENT_CAPACITY = 200;

    private final EpisodesSink sink;
    private final V1JudgeStore store;
    private final V1Policy defaultPolicy;
    private final LongSupplier clock;
    private final Map<String, Entry> sessions = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> recentEnded = new LinkedHashMap<>(16, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Map<String, Object>> eldest) {
            return size() > RECENT_CAPACITY;
        }
    };
    private final AtomicLong decisions = new AtomicLong();
    private final AtomicLong progresses = new AtomicLong();
    private final AtomicLong skipped = new AtomicLong();
    private final AtomicLong restored = new AtomicLong();

    private static final class Entry {
        final V1SessionJudge judge;
        volatile String userId;
        volatile long lastSeenWallMs;

        Entry(V1SessionJudge judge, String userId, long now) {
            this.judge = judge;
            this.userId = userId;
            this.lastSeenWallMs = now;
        }
    }

    @Autowired
    public V1JudgeRegistry(
            EpisodesSink sink,
            V1JudgeStore store,
            @Value("${cep.persist-seconds:3}") double holdSeconds,
            @Value("${cep.recovery-seconds:3}") double recoverySeconds,
            @Value("${cep.realert-seconds:60}") double reminderSeconds,
            @Value("${cep.collapse-threshold:0.7}") double threshold) {
        this(sink, store, new V1Policy(Math.round(holdSeconds * 1000), Math.round(recoverySeconds * 1000),
                Math.round(reminderSeconds * 1000), threshold), System::currentTimeMillis);
    }

    V1JudgeRegistry(EpisodesSink sink, V1Policy defaultPolicy, LongSupplier clock) {
        this(sink, V1JudgeStore.NO_OP, defaultPolicy, clock);
    }

    V1JudgeRegistry(EpisodesSink sink, V1JudgeStore store, V1Policy defaultPolicy, LongSupplier clock) {
        this.sink = sink;
        this.store = store;
        this.defaultPolicy = defaultPolicy;
        this.clock = clock;
    }

    public void sessionStarted(String sessionId, String userId, Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> policyBody = body != null && body.get("policy") instanceof Map<?, ?> p
                ? (Map<String, Object>) p : null;
        V1Policy policy = V1Policy.fromBody(policyBody, defaultPolicy);
        Entry existing = sessions.get(sessionId);
        if (existing == null) {
            existing = restore(sessionId);
        }
        if (existing != null && existing.judge.hasInput()) {
            log.warn("이미 관측을 받은 세션의 session_started — 무시 (sessionId={})", sessionId);
            return;
        }
        Entry e = new Entry(new V1SessionJudge(sessionId, policy), userId, clock.getAsLong());
        sessions.put(sessionId, e);
        synchronized (recentEnded) {
            recentEnded.remove(sessionId);
        }
        save(sessionId, e);
        log.info("v1 세션 시작 (sessionId={}, policy={})", sessionId, policy);
    }

    /** @return 반영하지 않았으면 그 이유, 반영했으면 null */
    public String observation(String sessionId, String userId, Map<String, Object> body) {
        V1Observation o = V1Observation.fromBody(body);   // 형식 오류는 호출 쪽에서 DLQ
        Entry e = sessions.get(sessionId);
        if (e == null) {
            e = restore(sessionId);
        }
        if (e == null) {
            log.info("session_started 없이 관측을 받음 — 기본 정책으로 판정 (sessionId={})", sessionId);
            Entry created = new Entry(new V1SessionJudge(sessionId, defaultPolicy), userId, clock.getAsLong());
            Entry prev = sessions.putIfAbsent(sessionId, created);
            e = prev != null ? prev : created;
        }
        e.lastSeenWallMs = clock.getAsLong();
        if (userId != null) {
            e.userId = userId;
        }
        V1SessionJudge.Result r = e.judge.accept(o);
        emit(sessionId, e.userId, r);
        if (r.skipped() == null) {
            save(sessionId, e);
        }
        return r.skipped();
    }

    public void sessionEnded(String sessionId, String userId, Map<String, Object> body) {
        Entry e = sessions.get(sessionId);
        if (e == null) {
            e = restore(sessionId);
        }
        if (e == null) {
            log.warn("모르는 세션의 session_ended — 무시 (sessionId={})", sessionId);
            return;
        }
        long at = body != null && body.get("end_ms") instanceof Number n ? n.longValue() : 0;
        V1SessionJudge.Result r = e.judge.end(at);
        emit(sessionId, userId != null ? userId : e.userId, r);
        finish(sessionId, e);
    }

    /** 입력이 timeoutSeconds 동안 없는 세션을 정리한다. @return 정리한 세션 수 */
    public int expireStale(long timeoutSeconds) {
        long now = clock.getAsLong();
        List<String> expired = new ArrayList<>();
        sessions.forEach((id, e) -> {
            if (now - e.lastSeenWallMs >= timeoutSeconds * 1000) {
                expired.add(id);
            }
        });
        for (String id : expired) {
            Entry e = sessions.get(id);
            if (e == null) {
                continue;
            }
            emit(id, e.userId, e.judge.expire());
            finish(id, e);
            log.info("v1 세션 만료 — {}초 동안 입력 없음 (sessionId={})", timeoutSeconds, id);
        }
        return expired.size();
    }

    public Optional<Map<String, Object>> view(String sessionId) {
        Entry e = sessions.get(sessionId);
        if (e != null) {
            return Optional.of(e.judge.view());
        }
        synchronized (recentEnded) {
            return Optional.ofNullable(recentEnded.get(sessionId));
        }
    }

    public Map<String, Object> status() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("activeSessions", sessions.size());
        synchronized (recentEnded) {
            s.put("recentEndedSessions", recentEnded.size());
        }
        s.put("publishedDecisions", decisions.get());
        s.put("publishedProgress", progresses.get());
        s.put("skippedObservations", skipped.get());
        s.put("restoredSessions", restored.get());
        s.put("defaultPolicy", defaultPolicy.toString());
        return s;
    }

    private void emit(String sessionId, String userId, V1SessionJudge.Result r) {
        if (r.skipped() != null) {
            skipped.incrementAndGet();
            log.debug("관측 반영 안 함 (sessionId={}): {}", sessionId, r.skipped());
            return;
        }
        String uid = userId != null && !userId.isBlank() ? userId : "unknown";
        for (Map<String, Object> d : r.decisions()) {
            sink.publish(sessionId, uid, "decision", d);
            decisions.incrementAndGet();
            @SuppressWarnings("unchecked")
            Map<String, Object> event = (Map<String, Object>) d.get("event");
            log.info("v1 판정 사건: {} (sessionId={}, event_id={}, t={}ms)",
                    event.get("kind"), sessionId, event.get("event_id"), event.get("timestamp_ms"));
        }
        if (r.progress() != null) {
            sink.publish(sessionId, uid, "progress", r.progress());
            progresses.incrementAndGet();
        }
    }

    /** (D-37) 저장소에서 판정기를 되살려 등록한다. 없거나 복원할 수 없으면 null. */
    private Entry restore(String sessionId) {
        Optional<V1JudgeStore.Stored> stored = store.load(sessionId);
        if (stored.isEmpty()) {
            return null;
        }
        V1SessionJudge judge;
        try {
            judge = V1SessionJudge.restore(stored.get().judge());
        } catch (RuntimeException exc) {
            log.warn("v1 판정 상태를 복원할 수 없어 버림 (sessionId={}): {}", sessionId, exc.getMessage());
            store.delete(sessionId);
            return null;
        }
        Map<String, Object> v = judge.view();
        if (judge.ended() || !sessionId.equals(v.get("session_id"))) {
            store.delete(sessionId);
            return null;
        }
        Entry created = new Entry(judge, stored.get().userId(), clock.getAsLong());
        Entry prev = sessions.putIfAbsent(sessionId, created);
        if (prev != null) {
            return prev;
        }
        restored.incrementAndGet();
        log.info("v1 판정 상태 복원 (sessionId={}, last_sequence={}, active={}, events={})",
                sessionId, v.get("last_sequence"), v.get("active"), ((List<?>) v.get("events")).size());
        return created;
    }

    private void save(String sessionId, Entry e) {
        store.save(sessionId, e.userId, e.judge.snapshot());
    }

    private void finish(String sessionId, Entry e) {
        sessions.remove(sessionId, e);
        store.delete(sessionId);
        synchronized (recentEnded) {
            recentEnded.put(sessionId, e.judge.view());
        }
    }
}
