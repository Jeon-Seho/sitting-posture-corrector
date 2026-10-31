package org.posegood.api.session;

import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.FrameParts;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 측정 흐름: 세션 생성, 좌표 처리(추론 요청 → 판정 엔진이 결과를 모아 판정 → DB 기록), 종료.
 *
 * 생성·종료·조회는 HTTP, 측정 입력은 실시간 채널이 쓴다(계획 0064). 실시간 v2로 받은 좌표 구간은 바로 판정 엔진에
 * 자리를 잡고 그 프레임을 추론 v3에 넘긴다({@link InferenceGateway}: HTTP면 결과가 바로, Kafka면
 * {@link #inferred}로 나중에 온다). 판정 엔진은 결과를 모았다가 서버 시계로 {@code posegood.realtime.batch-window}
 * (기본 3초)마다 앞에서부터 프레임마다 판정한다. 쉬기·자리 비움 구간에는 기다리지 않고, 종료·끊김·자정 넘김에는 남은
 * 결과를 {@code posegood.inference.result-timeout}까지 기다린 뒤 판정한다. 그 시간 안에 오지 않은 결과는 누락이다.
 * 판정은 세션 잠금 안에서 하고, 새 사건은 DB에 쓴다. DB 쓰기가 실패해도 판정 상태는 유지되고 다음 처리 때 남은 사건을 쓴다.
 * KST 자정에는 실시간 연결이 {@link #rollover}로 이전 세션을 끝내고 새 세션으로 잇는다(BE-6 ① B안).
 */
@Service
public class SessionService {
    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    private final LiveSessions live;
    private final SessionRepository sessions;
    private final BaselineRepository baselines;
    private final ThresholdPolicyRepository policies;
    private final AccountService accounts;
    private final InferenceGateway inference;
    private final UserLocks locks;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;
    private final long maxSessionMs;
    /** 측정불가(판정 불가·자리 비움)가 이만큼 이어지면 세션을 끝낸다. 0이면 끈다. */
    private final long unmeasurableTimeoutMs;
    /** 판정 엔진이 결과를 모으는 서버 시간. 0이면 결과가 올 때마다 판정한다. */
    private final long batchWindowNanos;
    /** 추론 결과를 기다리는 가장 긴 서버 시간. 넘으면 그 구간은 누락이다. */
    private final long resultTimeoutNanos;
    /** 판정할 때가 된 세션을 스스로 판정하는 일꾼(새 구간이 오지 않을 때·Kafka 결과가 왔을 때). 세션마다 잠금으로 차례를 지킨다. */
    private final ExecutorService flusher =
            Executors.newFixedThreadPool(
                    4,
                    work -> {
                        var thread = new Thread(work, "realtime-batch");
                        thread.setDaemon(true);
                        return thread;
                    });

    public SessionService(
            LiveSessions live,
            SessionRepository sessions,
            BaselineRepository baselines,
            ThresholdPolicyRepository policies,
            AccountService accounts,
            InferenceGateway inference,
            UserLocks locks,
            TransactionTemplate tx,
            ApplicationEventPublisher events,
            @Value("${posegood.realtime.max-session-duration}") Duration maxSession,
            @Value("${posegood.realtime.unmeasurable-timeout}") Duration unmeasurableTimeout,
            @Value("${posegood.realtime.batch-window}") Duration batchWindow,
            @Value("${posegood.inference.result-timeout}") Duration resultTimeout) {
        this.live = live;
        this.sessions = sessions;
        this.baselines = baselines;
        this.policies = policies;
        this.accounts = accounts;
        this.inference = inference;
        this.locks = locks;
        this.tx = tx;
        this.events = events;
        this.maxSessionMs = maxSession.toMillis();
        this.unmeasurableTimeoutMs = unmeasurableTimeout.toMillis();
        this.batchWindowNanos = batchWindow.toNanos();
        this.resultTimeoutNanos = resultTimeout.toNanos();
    }

    /**
     * 세션 생성: 현재 계정 정책·기준 확인 → 세션 행 추가 → 메모리에 판정 엔진 준비.
     *
     * 재시도는 같은 정책·기준 ID여야 한다.
     */
    public SessionView create(long owner, UUID id, SessionRequests.Create request) {
        ThresholdPolicyRepository.Values.of(request.policy());
        return locks.withLock(
                owner,
                () -> {
                    var existing = live.get(id);
                    if (existing != null) {
                        if (existing.owner() != owner) throw ApiError.notFound();
                        return existing.locked(
                                () -> {
                                    requireSame(existing, request);
                                    return existing.engine().view();
                                });
                    }
                    var stored = sessions.find(id);
                    if (stored != null) {
                        if (stored.owner() != owner) throw ApiError.notFound();
                        throw ApiError.lost();
                    }
                    var account = accounts.requireActive(owner);
                    if (!policies.read(account.policyId()).policy().equals(request.policy()))
                        throw ApiError.conflict("settings changed; reload workspace before measuring");
                    var baseline = baselines.current(owner);
                    if (baseline == null) throw new ApiError(409, "BASELINE_REQUIRED", "register a baseline first");
                    if (!baseline.id().equals(request.baselineId())) throw ApiError.conflict("baseline was replaced");
                    boolean alerts = account.alertsEnabled();
                    live.ensureRoom();
                    var row =
                            tx.execute(
                                    status -> {
                                        var now = KstTime.now();
                                        sessions.insert(
                                                owner,
                                                id,
                                                account.policyId(),
                                                baseline.key(),
                                                alerts,
                                                now);
                                        return sessions.find(id);
                                    });
                    var session = new LiveSession(row, new SessionEngine(id, request.policy(), maxSessionMs));
                    live.add(session);
                    return session.engine().view();
                });
    }

    /**
     * 실시간 v2 측정 연결 준비: 내 세션인지, 아직 진행 중인지, 판정에 쓸 기준 자세가 있는지 확인한다.
     *
     * 끝난 세션은 409 SESSION_ENDED, 기준이 없거나 판정에 쓸 수 없으면 409 BASELINE_REQUIRED.
     */
    public Realtime openRealtime(long owner, UUID id) {
        var session = require(owner, id);
        if (session.locked(() -> session.engine().ended())) throw ApiError.ended();
        var stored = baselines.find(owner, session.row().baselineId());
        if (stored == null || FrameFeatures.baseline(stored.landmarks()) == null)
            throw new ApiError(409, "BASELINE_REQUIRED", "register a baseline first");
        return new Realtime(stored.landmarks(), session.row().alertEnabled(), session.row().startedAt());
    }

    /**
     * 실시간 v2 좌표 구간 하나를 받아 판정 엔진에 자리를 잡고 그 프레임을 추론에 넘긴다(판정은 {@link #flush}). 받은
     * 순번을 돌려준다.
     *
     * v2는 재전송이 없으므로 같은 순번·앞선 순번·겹치는 시간은 409 CONFLICT, 최대 측정 시간을 넘으면 429다.
     * {@code baseline}은 세션 기준 자세이고 추론에 함께 넘긴다. 추론에 넘기지 못하면 그 구간은 누락이 된다(판정 때
     * {@code stalled}).
     */
    public long frames(long owner, UUID id, FrameInterval interval, SessionRequests.Landmarks baseline) {
        var session = require(owner, id);
        return session.locked(
                () -> {
                    var engine = session.engine();
                    if (engine.hold(interval, System.nanoTime())) submit(session, interval, baseline);
                    else engine.fill(interval.sequence(), List.of(), inference.modelVersion());
                    return interval.sequence();
                });
    }

    private void submit(LiveSession session, FrameInterval interval, SessionRequests.Landmarks baseline) {
        var engine = session.engine();
        var frames = FrameParts.frames(interval).stream().map(FrameInference.Frame::of).toList();
        try {
            var response =
                    inference.submit(session.id(), interval.sequence(), FrameInference.Request.of(baseline, frames));
            if (response != null) engine.fill(interval.sequence(), response.frames(), response.modelVersion());
        } catch (ApiError failed) {
            log.debug("inference request failed: {}", failed.code());
            engine.fail(interval.sequence());
        }
    }

    /**
     * Kafka 추론 결과 하나({@link InferenceResultListener}): 요청한 프레임과 대조해 판정 엔진의 그 구간 자리에 넣는다.
     *
     * 세션 잠금 없이 넣는다(종료 처리가 잠금을 잡은 채 결과를 기다린다). 이 서버에 없는 세션이거나 이미 판정·누락된
     * 구간이면 버린다. 계약과 맞지 않으면 그 구간은 누락이다. 판정할 때가 되면 바로 판정을 맡긴다.
     */
    public void inferred(UUID id, long sequence, FrameInference.Response response) {
        var session = live.get(id);
        if (session == null) return;
        var engine = session.engine();
        var frames = engine.heldFrames(sequence);
        if (frames == null) return;
        try {
            InferenceClient.check(
                    frames.stream().map(FrameInference.Frame::of).toList(), response, inference.modelVersion());
            engine.fill(sequence, response.frames(), response.modelVersion());
        } catch (ApiError mismatch) {
            log.debug("inference result rejected: {}", mismatch.code());
            engine.fail(sequence);
        }
        schedule(session);
    }

    /**
     * 판정할 때면(판정 엔진이 결과를 batch-window만큼 모음, 쉬기·자리 비움, 기다리던 결과가 옴) 판정·DB 기록을 한다.
     * 실시간 채널이 구간을 받을 때마다 부른다. DB 일시 장애는 503이다.
     */
    public void flush(long owner, UUID id) {
        var session = require(owner, id);
        session.locked(
                () -> {
                    if (due(session)) drain(session, false);
                    return null;
                });
    }

    /** 200ms마다: 새 구간이 오지 않아도 판정할 때가 된 세션을 판정한다. 실패는 실시간 채널에 stalled로 알린다. */
    @Scheduled(fixedDelay = 200)
    public void flushWaiting() {
        for (var session : live.all()) schedule(session);
    }

    @jakarta.annotation.PreDestroy
    public void shutdown() {
        flusher.shutdownNow();
    }

    private boolean due(LiveSession session) {
        return session.engine().due(System.nanoTime(), batchWindowNanos, resultTimeoutNanos);
    }

    private void schedule(LiveSession session) {
        if (due(session) && session.queue()) flusher.execute(() -> flushQuietly(session));
    }

    private void flushQuietly(LiveSession session) {
        try {
            session.locked(
                    () -> {
                        if (due(session)) drain(session, false);
                        return null;
                    });
        } catch (ApiError | DataAccessException failed) {
            log.debug("realtime judgement skipped: {}", failed.getClass().getSimpleName());
            events.publishEvent(new SessionUpdates.Stalled(session.id()));
        } finally {
            session.dequeued();
        }
    }

    /**
     * 판정 한 번(세션 잠금 안): 판정 엔진이 모은 결과를 앞에서부터 프레임마다 판정 → DB 기록 → 관측 4.0·사건 알림.
     *
     * {@code force}면 결과를 기다리지 않고 남은 구간을 모두 처리한다. 추론이 실패했거나 결과가 오지 않은 구간은 버리고
     * (다음 구간과의 시간은 누락) {@code stalled}를 알린다. 측정불가 시간 초과에 닿으면 그 구간 끝에서 끝낸다.
     */
    private void drain(LiveSession session, boolean force) {
        var engine = session.engine();
        if (engine.ended()) return;
        int before = engine.eventCount();
        var batch = engine.judge(System.nanoTime(), resultTimeoutNanos, force, unmeasurableTimeoutMs);
        String closedReason = null;
        if (batch.timedOut()) {
            // 측정불가가 이어진 시간이 찬 그 구간 끝에서 끝내고 저장한다(2026-10-26 결정).
            session.endReason("UNMEASURABLE_TIMEOUT");
            closedReason = "unmeasurable_timeout";
        }
        try {
            if (batch.judged() == 0) return;
            // 새 사건은 decision을 보내기 전에 DB에 쓴다. DB가 실패해도 결과는 보내고(그 뒤 stalled), 다음 처리 때 다시 쓴다.
            try {
                persist(session);
            } finally {
                publish(session, FrameParts.live(batch.results(), engine::posture), before, closedReason);
            }
        } finally {
            if (batch.dropped() > 0) events.publishEvent(new SessionUpdates.Stalled(session.id()));
        }
    }

    /**
     * 끝내기 전에 남은 구간을 판정한다. 아직 오지 않은 추론 결과는 {@code posegood.inference.result-timeout}까지 기다리고,
     * 그래도 오지 않거나 DB가 실패하면 그 구간은 버리고(누락) 종료는 그대로 한다.
     */
    private void drainBeforeEnd(LiveSession session) {
        session.engine().awaitSettled(System.nanoTime() + resultTimeoutNanos);
        try {
            drain(session, true);
        } catch (ApiError | DataAccessException failed) {
            log.debug("realtime batch dropped at end: {}", failed.getClass().getSimpleName());
        }
    }

    /**
     * 실시간 v2 종료.
     *
     * {@code endMs}가 null이면 연결이 끊긴 것으로 보고 마지막으로 받은 구간 끝에서 끝낸다(ADR 0024).
     * 앱의 {@code end_ms}가 마지막 구간보다 앞서면 마지막 구간 끝을 쓴다. 이미 끝났으면 그대로 둔다.
     */
    public void finish(long owner, UUID id, Long endMs) {
        var session = require(owner, id);
        session.locked(
                () -> {
                    var engine = session.engine();
                    drainBeforeEnd(session);
                    if (engine.ended()) return null;
                    long last = engine.summary().totalMs();
                    if (endMs == null) session.endReason("DISCONNECTED");
                    int before = engine.eventCount();
                    engine.end(endMs == null ? last : Math.max(endMs, last));
                    publish(session, null, before, null);
                    persist(session);
                    return null;
                });
    }

    /**
     * 자정 넘김(BE-6 ① B안): 이전 세션을 마지막으로 받은 구간 끝에서 끝내 저장하고, 자정({@code midnight})에 시작하는
     * 새 세션을 만든다.
     *
     * 이전 세션의 종료 시각은 그래서 자정 전이고, 종료 이벤트의 closed 사유는 {@code day_changed}다. 새 세션 ID는
     * 서버가 만들고 기준 자세·임계값 설정·알림 설정은 이전 세션 것을 쓴다(S1의 계정 확인은 다시 하지 않는다).
     * {@code limitMs}는 새 세션의 최대 측정 시간 상한이다. 새 세션을 만들지 못하면(자리 없음·DB 장애) 예외가 나고
     * 이전 세션은 끝난 채 남는다.
     */
    public Rollover rollover(long owner, UUID id, Instant midnight, long limitMs) {
        var previous = require(owner, id);
        return locks.withLock(
                owner,
                () -> {
                    var ended =
                            previous.locked(
                                    () -> {
                                        var engine = previous.engine();
                                        drainBeforeEnd(previous);
                                        if (engine.ended()) throw ApiError.ended();
                                        previous.endReason("DAY_CHANGED");
                                        int before = engine.eventCount();
                                        var view = engine.end(engine.summary().totalMs());
                                        publish(previous, null, before, "day_changed");
                                        persist(previous);
                                        return view.summary();
                                    });
                    var nextId = UUID.randomUUID();
                    live.ensureRoom();
                    var row =
                            tx.execute(
                                    status -> {
                                        sessions.insertFollowing(previous.row(), nextId, KstTime.of(midnight));
                                        return sessions.find(nextId);
                                    });
                    var policy = previous.engine().policy();
                    live.add(new LiveSession(row, new SessionEngine(nextId, policy, Math.min(maxSessionMs, limitMs))));
                    return new Rollover(
                            ended,
                            previous.row().startedAt().plusMillis(ended.totalMs()),
                            nextId,
                            row.startedAt(),
                            row.alertEnabled());
                });
    }

    /**
     * 세션 종료(같은 end_ms 재전송은 같은 결과).
     *
     * 끝난 뒤 다른 {@code end_ms}는 409.
     */
    public SessionView end(long owner, UUID id, long endMs) {
        var session = require(owner, id);
        return session.locked(
                () -> {
                    drainBeforeEnd(session);
                    int before = session.engine().eventCount();
                    var view = session.engine().end(endMs);
                    if (session.engine().eventCount() > before) publish(session, null, before, null);
                    persist(session);
                    return view;
                });
    }

    /** 현재 상태 조회. */
    public SessionView get(long owner, UUID id) {
        var session = require(owner, id);
        return session.locked(() -> session.engine().view());
    }

    /**
     * 세션 삭제(DB 행과 메모리 상태). 기록 삭제(R3)가 쓴다.
     */
    public void delete(long owner, UUID id) {
        var stored = owned(owner, id);
        var session = live.get(id);
        if (session == null) {
            tx.executeWithoutResult(status -> sessions.delete(stored));
            return;
        }
        session.locked(
                () -> {
                    tx.executeWithoutResult(status -> sessions.delete(stored));
                    live.remove(id, "session_lost");
                    return null;
                });
    }

    /**
     * 메모리에 있는 내 세션. 다른 사람 것이면 404, 상태가 없으면 404 SESSION_LOST.
     */
    public LiveSession require(long owner, UUID id) {
        var session = live.get(id);
        if (session != null) {
            if (session.owner() != owner) throw ApiError.notFound();
            return session;
        }
        owned(owner, id);
        throw ApiError.lost();
    }

    /** DB에 있는 내 세션 행(없거나 남의 것이면 404). */
    public SessionRepository.Stored owned(long owner, UUID id) {
        var stored = sessions.find(id);
        if (stored == null || stored.owner() != owner) throw ApiError.notFound();
        return stored;
    }

    public String modelVersion() {
        return inference.modelVersion();
    }

    /** 새 결과를 실시간 채널로 알린다. {@code closedReason}은 서버가 스스로 끝냈을 때만 있다. */
    private void publish(LiveSession session, Observation.V4 live, int before, String closedReason) {
        var engine = session.engine();
        events.publishEvent(
                new SessionUpdates.Progressed(
                        session.id(),
                        engine.eventsAfter(before),
                        engine.lastSequence(),
                        engine.summary(),
                        engine.ended(),
                        live,
                        engine.pausedReason(),
                        closedReason));
    }

    /**
     * 아직 DB에 안 쓴 사건과 종료를 한 트랜잭션으로 쓴다.
     *
     * 진행 표시는 커밋 뒤에만 올리므로 실패하면 다음 호출이 다시 쓴다.
     */
    private void persist(LiveSession session) {
        var engine = session.engine();
        var pending = engine.eventsAfter(session.persistedEvents());
        boolean close = engine.ended() && !session.closePersisted();
        if (pending.isEmpty() && !close) return;
        int episodes =
                tx.execute(
                        status -> {
                            int episode = session.persistedEpisodes();
                            for (var decided : pending) {
                                if ("collapse_confirmed".equals(decided.event().kind())) episode++;
                                sessions.applyEvent(session.row(), decided.event(), episode);
                            }
                            if (close) {
                                var summary = engine.summary();
                                sessions.close(
                                        session.row(),
                                        new SessionRepository.Closing(
                                                summary.totalMs(),
                                                summary.normalMs(),
                                                engine.excluded()));
                            }
                            return episode;
                        });
        session.persisted(
                session.persistedEvents() + pending.size(), episodes, session.closePersisted() || close);
    }

    /** 같은 세션을 다시 만들 때 처음과 같은 정책·기준 자세인지 확인한다. */
    private static void requireSame(LiveSession session, SessionRequests.Create request) {
        var row = session.row();
        if (!session.engine().policy().equals(request.policy()))
            throw ApiError.conflict("policy already frozen");
        if (!row.baselineId().equals(request.baselineId()))
            throw ApiError.conflict("session setup already frozen");
    }

    /**
     * 실시간 v2 측정 연결에 필요한 것: 세션 기준 자세(추론에 함께 넘김), 알림을 켰는지, 시작 시각.
     *
     * {@code startedAt}은 서버가 S1을 받은 시각(DB {@code started_at})이다. 앱에 그대로 알린다(ADR 0028).
     */
    public record Realtime(SessionRequests.Landmarks baseline, boolean alertEnabled, Instant startedAt) {}

    /**
     * 자정 넘김 결과: 끝난 이전 세션의 요약·서버 종료 시각(DB {@code ended_at}), 새 세션 ID·시작 시각(자정)·알림 설정.
     */
    public record Rollover(
            SessionView.Summary ended, Instant endedAt, UUID sessionId, Instant startedAt, boolean alertEnabled) {}
}
