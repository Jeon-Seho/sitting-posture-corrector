package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Observation;
import org.posegood.api.engine.SessionEngine;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * 진행 중 세션 하나의 메모리 상태: DB 행, 판정 엔진, 재전송 확인용 지문, DB 기록 진행 정도.
 *
 * 모든 접근은 {@link #locked}를 거친다.
 */
public final class LiveSession {
    private final SessionRepository.Stored row;
    private final SessionEngine engine;
    private final ReentrantLock lock = new ReentrantLock();
    private final Map<Long, Input> inputs = new HashMap<>();
    private int persistedEvents;
    private int persistedEpisodes;
    private boolean closePersisted;
    private String endReason = "USER_STOP";
    private volatile long touchedAt = System.nanoTime();

    LiveSession(SessionRepository.Stored row, SessionEngine engine) {
        this.row = row;
        this.engine = engine;
    }

    public UUID id() {
        return row.id();
    }

    public long owner() {
        return row.owner();
    }

    public SessionRepository.Stored row() {
        return row;
    }

    public SessionEngine engine() {
        return engine;
    }

    /**
     * 세션 잠금 안에서 작업 실행(10초 안에 못 잡으면 503).
     *
     * 세션마다 요청을 하나씩 처리한다. 입력 순서를 지키려고 추론도 잠금 안에서 부른다.
     */
    public <T> T locked(Supplier<T> work) {
        boolean acquired;
        try {
            acquired = lock.tryLock(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            acquired = false;
        }
        if (!acquired)
            throw new ApiError(503, "SESSION_BUSY", "session is busy; retry same request");
        try {
            touchedAt = System.nanoTime();
            return work.get();
        } finally {
            lock.unlock();
        }
    }

    long idleNanos() {
        return System.nanoTime() - touchedAt;
    }

    Input input(long sequence) {
        return inputs.get(sequence);
    }

    void remember(long sequence, String fingerprint, Observation observation) {
        inputs.put(sequence, new Input(fingerprint, observation));
    }

    int persistedEvents() {
        return persistedEvents;
    }

    int persistedEpisodes() {
        return persistedEpisodes;
    }

    boolean closePersisted() {
        return closePersisted;
    }

    /** 종료 원인(USER_STOP·DISCONNECTED). V2.3에서 `monitor_session.end_reason`이 없어져 DB에 쓰지 않고, 지금은 읽는 곳이 없다. */
    String endReason() {
        return endReason;
    }

    void endReason(String reason) {
        endReason = reason;
    }

    void persisted(int events, int episodes, boolean closed) {
        persistedEvents = events;
        persistedEpisodes = episodes;
        closePersisted = closed;
    }

    /** 재전송 요청은 SHA-256 지문으로 알아보고 처음 관측 결과를 다시 쓴다. */
    record Input(String fingerprint, Observation observation) {}
}
