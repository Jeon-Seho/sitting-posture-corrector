package org.posegood.api.session;

import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

/**
 * 측정 흐름: 세션 생성, 특징 처리(추론 → 판정 → DB 기록), 종료, 기록 저장 때 마무리.
 *
 * HTTP와 실시간 채널이 함께 쓴다. 입력마다 세션 잠금 안에서 추론, 판정, 새 사건의 DB 기록을 한다.
 * DB 쓰기가 실패해도 판정 상태는 유지되고, 같은 요청을 다시 보내면 남은 사건을 쓴다(503 다음 성공).
 */
@Service
public class SessionService {
    private final LiveSessions live;
    private final SessionRepository sessions;
    private final ThresholdPolicyRepository policies;
    private final AccountService accounts;
    private final InferenceClient inference;
    private final UserLocks locks;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;

    public SessionService(
            LiveSessions live,
            SessionRepository sessions,
            ThresholdPolicyRepository policies,
            AccountService accounts,
            InferenceClient inference,
            UserLocks locks,
            TransactionTemplate tx,
            ApplicationEventPublisher events) {
        this.live = live;
        this.sessions = sessions;
        this.policies = policies;
        this.accounts = accounts;
        this.inference = inference;
        this.locks = locks;
        this.tx = tx;
        this.events = events;
    }

    /**
     * 세션 생성: 기준 자세 저장 → 세션 행 추가 → 메모리에 판정 엔진 준비.
     *
     * 재시도는 같은 정책·준비 정보여야 한다.
     */
    public SessionView create(long owner, UUID id, SessionRequests.Create request) {
        var setup = request.setup();
        if (setup == null) throw ApiError.badRequest("session setup is required");
        var values = ThresholdPolicyRepository.Values.of(request.policy());
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
                    boolean alerts = accounts.requireActive(owner).alertsEnabled();
                    live.ensureRoom();
                    var row =
                            tx.execute(
                                    status -> {
                                        var now = KstTime.now();
                                        sessions.registerBaseline(owner, setup.baseline(), now);
                                        sessions.insert(
                                                owner,
                                                id,
                                                policies.resolve(values),
                                                setup.baseline().baselineId(),
                                                alerts,
                                                now);
                                        return sessions.find(id);
                                    });
                    var session = new LiveSession(row, new SessionEngine(id, request.policy()));
                    live.add(session);
                    return session.engine().view();
                });
    }

    /** 특징 입력 처리: 재전송 확인 → 추론 → 판정 → 실시간 알림 → DB 기록. */
    public SessionRequests.FeatureResponse features(long owner, UUID id, InferenceRequest request) {
        var session = require(owner, id);
        return session.locked(
                () -> {
                    String digest = fingerprint(request);
                    var cached = session.input(request.sequence());
                    if (cached != null) {
                        if (!cached.fingerprint().equals(digest))
                            throw ApiError.conflict("conflicting duplicate");
                        persist(session);
                        return response(cached.observation(), session.engine().view());
                    }
                    var engine = session.engine();
                    var view = engine.view();
                    if (view.ended()) throw ApiError.ended();
                    if (request.sequence() <= view.lastSequence()
                            || request.startMs() < view.summary().totalMs())
                        throw ApiError.conflict("out-of-order or overlapping interval");
                    if (engine.acceptedCount() >= SessionEngine.MAX_OBSERVATIONS)
                        throw ApiError.limit("session observation limit reached");
                    if (!session.row().baselineId().equals(request.baselineId()))
                        throw ApiError.conflict("baseline already frozen");
                    int before = engine.eventCount();
                    var observation = inference.infer(request);
                    var result = engine.accept(observation);
                    session.remember(request.sequence(), digest, observation);
                    publish(session, observation, before);
                    persist(session);
                    return response(observation, result);
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
                    int before = session.engine().eventCount();
                    var view = session.engine().end(endMs);
                    if (session.engine().eventCount() > before) publish(session, null, before);
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
                            publish(session, null, before);
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

    /** 새 결과를 실시간 채널로 알린다. */
    private void publish(LiveSession session, Observation observation, int before) {
        var engine = session.engine();
        events.publishEvent(
                new SessionUpdates.Progressed(
                        session.id(),
                        observation,
                        engine.eventsAfter(before),
                        engine.lastSequence(),
                        engine.summary(),
                        engine.ended()));
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
                                                summary.validMs(),
                                                summary.normalMs(),
                                                summary.collapseCount(),
                                                engine.excluded()),
                                        session.endReason());
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
        var setup = request.setup();
        if (!session.engine().policy().equals(request.policy()))
            throw ApiError.conflict("policy already frozen");
        if (!row.baselineId().equals(setup.baseline().baselineId()))
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

    /** {@code GET /v1/sessions/{id}/metadata} 응답. 모르는 값은 null. */
    public record Metadata(Instant startedAt, Instant endedAt, UUID baselineId, String modelVersion) {}
}
