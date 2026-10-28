package org.posegood.api.session;

import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 측정 흐름: 세션 생성, 특징 처리(추론 → 판정 → DB 기록), 종료, 기록 저장 때 마무리.
 *
 * HTTP와 실시간 채널이 함께 쓴다. 입력마다 세션 잠금 안에서 추론, 판정, 새 사건의 DB 기록을 한다.
 * DB 쓰기가 실패해도 판정 상태는 유지되고, 같은 요청을 다시 보내면 남은 사건을 쓴다(503 다음 성공).
 * 실시간 v2는 좌표 구간을 받아 {@link FrameFeatures}로 특징 변화량을 계산한 뒤 같은 추론·판정 흐름에 넣는다(A안).
 * KST 자정에는 실시간 연결이 {@link #rollover}로 이전 세션을 끝내고 새 세션으로 잇는다(BE-6 ① B안).
 */
@Service
public class SessionService {

    private final LiveSessions live;
    private final SessionRepository sessions;
    private final BaselineRepository baselines;
    private final ThresholdPolicyRepository policies;
    private final AccountService accounts;
    private final InferenceClient inference;
    private final UserLocks locks;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;
    private final long maxSessionMs;
    /** 측정불가(판정 불가·자리 비움)가 이만큼 이어지면 세션을 끝낸다. 0이면 끈다. */
    private final long unmeasurableTimeoutMs;

    public SessionService(
            LiveSessions live,
            SessionRepository sessions,
            BaselineRepository baselines,
            ThresholdPolicyRepository policies,
            AccountService accounts,
            InferenceClient inference,
            UserLocks locks,
            TransactionTemplate tx,
            ApplicationEventPublisher events,
            @Value("${posegood.realtime.max-session-duration}") Duration maxSession,
            @Value("${posegood.realtime.unmeasurable-timeout}") Duration unmeasurableTimeout) {
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

    /** 특징 입력 처리: 재전송 확인 → 추론 → 판정 → 실시간 알림 → DB 기록. */
    public SessionRequests.FeatureResponse features(long owner, UUID id, InferenceRequest request) {
        var session = require(owner, id);
        return session.locked(
                () -> {
                    var accepted = accept(session, request, null);
                    return response(accepted.observation(), accepted.view());
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
        var features = stored == null ? null : FrameFeatures.baseline(stored.landmarks());
        if (features == null) throw new ApiError(409, "BASELINE_REQUIRED", "register a baseline first");
        return new Realtime(features, session.row().alertEnabled(), session.row().startedAt());
    }

    /**
     * 실시간 v2 좌표 구간 하나: 특징 변화량 계산 → 기존 추론·판정 흐름. 처리 뒤의 진행 상황을 돌려준다.
     *
     * v2는 재전송이 없으므로 같은 순번은 409 CONFLICT다.
     */
    public Status frames(long owner, UUID id, FrameInterval interval, FrameFeatures.Features baseline) {
        var computed = FrameFeatures.interval(interval, baseline);
        var session = require(owner, id);
        return session.locked(
                () -> {
                    if (session.input(interval.sequence()) != null) throw ApiError.conflict("duplicate interval");
                    var request =
                            new InferenceRequest(
                                    "2.0",
                                    "shoulder-relative-deltas-v1",
                                    session.row().baselineId(),
                                    interval.sequence(),
                                    interval.startMs(),
                                    interval.endMs(),
                                    Observation.Phase.valueOf(interval.phase().name()),
                                    computed.deltas() == null
                                            ? InferenceRequest.MeasurementQuality.poor
                                            : InferenceRequest.MeasurementQuality.good,
                                    computed.deltas());
                    accept(session, request, computed.invalidReason());
                    return status(session.engine());
                });
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
                    if (engine.ended()) return null;
                    long last = engine.summary().totalMs();
                    if (endMs == null) session.endReason("DISCONNECTED");
                    int before = engine.eventCount();
                    engine.end(endMs == null ? last : Math.max(endMs, last));
                    publish(session, null, before, null, null);
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
                                        if (engine.ended()) throw ApiError.ended();
                                        previous.endReason("DAY_CHANGED");
                                        int before = engine.eventCount();
                                        var view = engine.end(engine.summary().totalMs());
                                        publish(previous, null, before, null, "day_changed");
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

    /** 입력 하나를 세션 잠금 안에서 처리한다. {@code invalidReason}은 좌표에서 찾은 판정 불가 사유다. */
    private Accepted accept(LiveSession session, InferenceRequest request, String invalidReason) {
        String digest = fingerprint(request);
        var cached = session.input(request.sequence());
        if (cached != null) {
            if (!cached.fingerprint().equals(digest)) throw ApiError.conflict("conflicting duplicate");
            persist(session);
            return new Accepted(cached.observation(), session.engine().view());
        }
        var engine = session.engine();
        var view = engine.view();
        if (view.ended()) throw ApiError.ended();
        if (request.sequence() <= view.lastSequence() || request.startMs() < view.summary().totalMs())
            throw ApiError.conflict("out-of-order or overlapping interval");
        if (!engine.admits(request.endMs())) throw ApiError.limit("session time limit reached");
        if (!session.row().baselineId().equals(request.baselineId()))
            throw ApiError.conflict("baseline already frozen");
        int before = engine.eventCount();
        var observation = inference.infer(request);
        var result = engine.accept(observation);
        session.remember(request.sequence(), digest, observation);
        String closedReason = null;
        if (unmeasurableTimeoutMs > 0 && !result.ended() && engine.unmeasurableMs() >= unmeasurableTimeoutMs) {
            // 측정불가가 이어진 시간이 찬 이 구간 끝에서 끝내고 저장한다(2026-10-26 결정).
            session.endReason("UNMEASURABLE_TIMEOUT");
            result = engine.end(result.summary().totalMs());
            closedReason = "unmeasurable_timeout";
        }
        publish(session, observation, before, invalidReason, closedReason);
        persist(session);
        return new Accepted(observation, result);
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
                    int before = session.engine().eventCount();
                    var view = session.engine().end(endMs);
                    if (session.engine().eventCount() > before) publish(session, null, before, null, null);
                    persist(session);
                    return view;
                });
    }

    /**
     * 기록을 저장할 때 아직 열린 세션 행을 닫는다.
     *
     * 판정 상태가 있으면 마지막 수신 시각에서 끝내 DISCONNECTED로, 상태를 잃었으면 ERROR로 닫는다.
     */
    public void closeForRecord(long owner, UUID id, long acknowledgedMs) {
        var session = live.get(id);
        if (session != null && session.owner() == owner) {
            session.locked(
                    () -> {
                        var engine = session.engine();
                        if (!engine.ended()) {
                            session.endReason("DISCONNECTED");
                            int before = engine.eventCount();
                            engine.end(engine.summary().totalMs());
                            publish(session, null, before, null, null);
                        }
                        persist(session);
                        return null;
                    });
            return;
        }
        var stored = owned(owner, id);
        if (stored.endedAt() == null)
            tx.executeWithoutResult(status -> sessions.closeLost(stored, acknowledgedMs));
    }

    /** 현재 상태 조회. */
    public SessionView get(long owner, UUID id) {
        var session = require(owner, id);
        return session.locked(() -> session.engine().view());
    }

    /**
     * 세션 삭제(DB 행과 메모리 상태).
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

    /** 시작·종료 시각, 기준 자세 ID, 모델 버전. */
    public Metadata metadata(long owner, UUID id) {
        var stored = owned(owner, id);
        var session = live.get(id);
        String model =
                session != null && session.locked(() -> session.engine().lastSequence() >= 0)
                        ? inference.modelVersion()
                        : null;
        return new Metadata(stored.startedAt(), stored.endedAt(), stored.baselineId(), model);
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
    private void publish(
            LiveSession session, Observation observation, int before, String invalidReason, String closedReason) {
        var engine = session.engine();
        events.publishEvent(
                new SessionUpdates.Progressed(
                        session.id(),
                        observation,
                        engine.eventsAfter(before),
                        engine.lastSequence(),
                        engine.summary(),
                        engine.ended(),
                        observation == null
                                ? null
                                : Observation.V3.of(observation, SessionEngine.invalidReason(observation, invalidReason)),
                        engine.pausedReason(),
                        closedReason));
    }

    private static Status status(SessionEngine engine) {
        return new Status(engine.lastSequence(), engine.summary(), engine.pausedReason());
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

    private static SessionRequests.FeatureResponse response(Observation observation, SessionView view) {
        return new SessionRequests.FeatureResponse("1.0", observation, view);
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
     * 재전송 비교용 요청 지문(SHA-256). 특징 값은 저장하지 않는다.
     */
    static String fingerprint(InferenceRequest request) {
        try {
            var bytes = new ByteArrayOutputStream();
            try (var output = new DataOutputStream(bytes)) {
                output.writeUTF(request.schemaVersion());
                output.writeUTF(request.featureVersion());
                output.writeUTF(request.baselineId().toString());
                output.writeLong(request.sequence());
                output.writeLong(request.startMs());
                output.writeLong(request.endMs());
                output.writeUTF(request.phase().name());
                output.writeUTF(request.measurementQuality().name());
                output.writeBoolean(request.features() != null);
                if (request.features() != null) {
                    var features = request.features();
                    output.writeDouble(features.headGapDelta());
                    output.writeDouble(features.lateralOffsetDelta());
                    output.writeDouble(features.shoulderTiltDelta());
                    output.writeDouble(features.currentQuality());
                    output.writeDouble(features.baselineQuality());
                }
            }
            return Json.sha256(bytes.toByteArray());
        } catch (IOException impossible) {
            throw new IllegalStateException("cannot fingerprint feature request", impossible);
        }
    }

    /** {@code GET /v2/sessions/{id}/metadata} 응답. 모르는 값은 null. */
    public record Metadata(Instant startedAt, Instant endedAt, UUID baselineId, String modelVersion) {}

    private record Accepted(Observation observation, SessionView view) {}

    /** 실시간 v2 측정 연결에 필요한 것: 세션 기준 자세의 특징, 알림을 켰는지. */
    /** {@code startedAt}은 서버가 S1을 받은 시각(DB {@code started_at})이다. 앱에 그대로 알린다(ADR 0028). */
    public record Realtime(FrameFeatures.Features baseline, boolean alertEnabled, Instant startedAt) {}

    /**
     * 자정 넘김 결과: 끝난 이전 세션의 요약·서버 종료 시각(DB {@code ended_at}), 새 세션 ID·시작 시각(자정)·알림 설정.
     */
    public record Rollover(
            SessionView.Summary ended, Instant endedAt, UUID sessionId, Instant startedAt, boolean alertEnabled) {}

    /** 실시간 v2 진행 상황: 마지막 순번, 요약, 측정이 멈춘 이유(없으면 null). */
    public record Status(long lastSequence, SessionView.Summary summary, String pausedReason) {}
}
