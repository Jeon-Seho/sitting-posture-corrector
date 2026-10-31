package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.engine.SessionEngine;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * 진행 중 세션 하나의 메모리 상태: DB 행, 판정 엔진(받은 구간 묶음도 엔진이 모은다, 계획 0084), DB 기록 진행 정도.
 *
 * 모든 접근은 {@link #locked}를 거친다. 예외: Kafka 추론 결과는 잠금 없이 판정 엔진에 바로 넣는다(엔진이 스스로
 * 동기화한다). 종료 처리가 잠금을 잡은 채 남은 결과를 기다리기 때문이다.
 */
public final class LiveSession {
    private final SessionRepository.Stored row;
    private final SessionEngine engine;
    private final ReentrantLock lock = new ReentrantLock();
    /** 스케줄러가 이 세션의 판정을 이미 맡겼는지(한 번에 하나만). */
    private final AtomicBoolean queued = new AtomicBoolean();
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
     * 세션마다 요청을 하나씩 처리한다. 입력 순서를 지키려고 추론 요청도 잠금 안에서 넘긴다.
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

    /** 스케줄러가 처리를 맡길 수 있으면 true(이미 맡겼으면 false). 처리가 끝나면 {@link #dequeued}. */
    boolean queue() {
        return queued.compareAndSet(false, true);
    }

    void dequeued() {
        queued.set(false);
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

    /** 종료 원인(USER_STOP·DISCONNECTED·UNMEASURABLE_TIMEOUT·DAY_CHANGED). V2.3에서 `monitor_session.end_reason`이 없어져 DB에 쓰지 않고, 지금은 읽는 곳이 없다. */
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
}
