package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.engine.SessionEngine;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * 진행 중 세션 하나의 메모리 상태: DB 행, 판정 엔진, 아직 판정하지 않은 좌표 구간 묶음, DB 기록 진행 정도.
 *
 * 모든 접근은 {@link #locked}를 거친다. 묶음이 기다린 시간만 잠금 없이 읽는다({@link #waiting}).
 */
public final class LiveSession {
    private final SessionRepository.Stored row;
    private final SessionEngine engine;
    private final ReentrantLock lock = new ReentrantLock();
    /** 받았지만 아직 판정하지 않은 구간(계획 0064: 서버 시계로 약 3초 모은다). */
    private final List<FrameInterval> pending = new ArrayList<>();
    private int pendingFrames;
    /** 묶음의 첫 구간을 받은 서버 시각({@link System#nanoTime}). 묶음이 비면 의미 없다. */
    private volatile long pendingSince;
    private volatile boolean holding;
    /** 스케줄러가 이 세션의 묶음 처리를 이미 맡겼는지(한 번에 하나만). */
    private final AtomicBoolean queued = new AtomicBoolean();
    /** 3초를 기다리지 않고 넘길 묶음: 쉬기·자리 비움 구간이 왔거나 프레임 수가 찼다. */
    private boolean flushNow;
    /** 추론에 함께 넘길 세션 기준 자세(실시간 연결이 준다). */
    private SessionRequests.Landmarks baseline;
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

    /** 받은 마지막 순번: 묶음에 있으면 그 끝, 없으면 판정한 마지막 순번. */
    long receivedSequence() {
        return pending.isEmpty() ? engine.lastSequence() : pending.get(pending.size() - 1).sequence();
    }

    /** 받은 마지막 구간의 끝 시각(세션 기준 ms). */
    long receivedEndMs() {
        return pending.isEmpty() ? engine.summary().totalMs() : pending.get(pending.size() - 1).endMs();
    }

    /**
     * 구간 하나를 묶음에 넣는다. 쉬기·자리 비움이면 바로 넘기게 표시한다(쉬기 전 프레임의 결과를 기다리지 않게).
     * 프레임 수가 추론 한도에 가까우면 바로 넘긴다(구간 하나는 30장까지라 한도를 넘지 않는다).
     */
    void hold(FrameInterval interval, SessionRequests.Landmarks baseline, long now) {
        if (pending.isEmpty()) pendingSince = now;
        pending.add(interval);
        pendingFrames += interval.frames().size();
        this.baseline = baseline;
        if (interval.phase() != FrameInterval.Phase.running || pendingFrames > FrameInference.MAX_FRAMES - 30)
            flushNow = true;
        holding = true;
    }

    /** 묶음을 넘길 때인지: 바로 넘길 표시가 있거나 {@code windowNanos}가 지났다(0이면 받을 때마다). */
    boolean due(long now, long windowNanos) {
        return !pending.isEmpty() && (flushNow || now - pendingSince >= windowNanos);
    }

    /** 잠금 없이 보는 대략의 판단(스케줄러가 쓴다). 실제 처리 전에는 잠금 안에서 {@link #due}로 다시 본다. */
    boolean waiting(long now, long windowNanos) {
        return holding && now - pendingSince >= windowNanos;
    }

    /** 스케줄러가 처리를 맡길 수 있으면 true(이미 맡겼으면 false). 처리가 끝나면 {@link #dequeued}. */
    boolean queue() {
        return queued.compareAndSet(false, true);
    }

    void dequeued() {
        queued.set(false);
    }

    /** 묶음을 꺼내고 비운다. 처리에 실패해도 다시 넣지 않는다(그 시간은 누락이 된다). */
    List<FrameInterval> takePending() {
        var batch = List.copyOf(pending);
        pending.clear();
        pendingFrames = 0;
        flushNow = false;
        holding = false;
        return batch;
    }

    SessionRequests.Landmarks baseline() {
        return baseline;
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
