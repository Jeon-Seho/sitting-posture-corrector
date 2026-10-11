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
 * In-memory state of one session: the frozen row, the decision engine, retry fingerprints, and how
 * far the decisions were written to the DB. Every access goes through {@link #locked}.
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

    /** One request at a time per session; inference runs inside the lock to keep input order. */
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

    /** `monitor_session.end_reason` written when the ended state is persisted. */
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

    /** A retried request is identified by its SHA-256; its original observation is reused. */
    record Input(String fingerprint, Observation observation) {}
}
