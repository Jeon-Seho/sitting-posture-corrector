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
 * Session lifecycle for HTTP and the realtime channel. Each input runs inference, the decision
 * engine and the DB write of new decisions under the session lock. A failed DB write keeps the
 * accepted state; the same request retried writes the remaining decisions (503 then success).
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

    /** Creates the row and the live state once; a retry must repeat the same policy and setup. */
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

    /** The same {@code end_ms} is idempotent; a different one after the end is 409. */
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
     * Closes a session the app archived without a confirmed end. Live state is ended at its last
     * accepted time and closed as DISCONNECTED; a row whose state was lost is closed as ERROR.
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

    public SessionView get(long owner, UUID id) {
        var session = require(owner, id);
        return session.locked(() -> session.engine().view());
    }

    /** Deletes the owner's session row (its app record) and its live state. */
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

    public Metadata metadata(long owner, UUID id) {
        var stored = owned(owner, id);
        var session = live.get(id);
        String model =
                session != null && session.locked(() -> session.engine().lastSequence() >= 0)
                        ? inference.modelVersion()
                        : null;
        return new Metadata(stored.startedAt(), stored.endedAt(), stored.baselineId(), model);
    }

    /** The owner's live session; a stored row without live state was lost by a restart. */
    public LiveSession require(long owner, UUID id) {
        var session = live.get(id);
        if (session != null) {
            if (session.owner() != owner) throw ApiError.notFound();
            return session;
        }
        owned(owner, id);
        throw ApiError.lost();
    }

    public SessionRepository.Stored owned(long owner, UUID id) {
        var stored = sessions.find(id);
        if (stored == null || stored.owner() != owner) throw ApiError.notFound();
        return stored;
    }

    public String modelVersion() {
        return inference.modelVersion();
    }

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
     * Writes decisions not yet in the DB and, once ended, closes the row, in one transaction. The
     * counters advance only after commit, so a failure is retried by the next call.
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

    private static void requireSame(LiveSession session, SessionRequests.Create request) {
        var row = session.row();
        var setup = request.setup();
        if (!session.engine().policy().equals(request.policy()))
            throw ApiError.conflict("policy already frozen");
        if (!row.baselineId().equals(setup.baseline().baselineId()))
            throw ApiError.conflict("session setup already frozen");
    }

    /** Compares retries without keeping or logging the feature values. */
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

    /** {@code GET /v1/sessions/{id}/metadata}; unknown values are null. */
    public record Metadata(Instant startedAt, Instant endedAt, UUID baselineId, String modelVersion) {}
}
