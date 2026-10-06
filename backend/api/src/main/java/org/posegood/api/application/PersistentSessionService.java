package org.posegood.api.application;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.account.UserStore;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.persistence.JdbcSessionStore;
import org.posegood.api.persistence.JdbcSessionStore.Stored;
import org.posegood.api.persistence.JsonCodec;
import org.posegood.api.persistence.UserLocks;
import org.posegood.contracts.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

@Service
@Profile("persistent")
public class PersistentSessionService implements SessionOperations {
    private final JdbcSessionStore store;
    private final InferenceGateway inference;
    private final PersistentCepCoordinator delivery;
    private final CurrentUser current;
    private final UserStore users;
    private final UserLocks locks;
    private final JsonCodec json;
    private final String modelVersion;
    private final String modelVersionCode;

    public PersistentSessionService(
            JdbcSessionStore store,
            InferenceGateway inference,
            PersistentCepCoordinator delivery,
            CurrentUser current,
            UserStore users,
            UserLocks locks,
            JsonCodec json,
            @Value("${posegood.model-version:reference-feature-rule-v1}") String modelVersion,
            @Value("${posegood.model-version-code:REFERENCE-RULE-1}") String modelVersionCode) {
        this.store = store;
        this.inference = inference;
        this.delivery = delivery;
        this.current = current;
        this.users = users;
        this.locks = locks;
        this.json = json;
        this.modelVersion = modelVersion;
        this.modelVersionCode = modelVersionCode;
    }

    public SessionView create(UUID id, CreateSession request, SessionSetup setup) {
        if (setup == null) throw new ContractError(400, "session setup is required");
        return owned(
                () -> {
                    long owner = current.id();
                    var existing = store.find(id);
                    if (existing != null) {
                        existing = store.require(owner, id);
                        requireSameSetup(existing, request.policy(), setup);
                        delivery.prepare(existing);
                        return existing.view();
                    }
                    var empty =
                            new SessionView(
                                    "1.0",
                                    id,
                                    request.policy(),
                                    "legacy-interrupt-v1",
                                    false,
                                    -1,
                                    new Summary(
                                            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, 0, null,
                                            null),
                                    List.of());
                    var session =
                            store.create(
                                    owner,
                                    id,
                                    request.policy(),
                                    setup,
                                    users.require(owner).soundAlerts(),
                                    modelVersionCode,
                                    empty);
                    requireSameSetup(session, request.policy(), setup);
                    delivery.prepare(session);
                    return session.view();
                });
    }

    public FeatureResponse features(UUID id, InferenceRequest request) {
        return owned(
                () -> {
                    var session = store.require(current.id(), id);
                    String digest = FeatureRequestFingerprint.of(request);
                    var cached = store.input(id, request.sequence());
                    if (cached != null) {
                        requireDuplicate(cached, JdbcSessionStore.FEATURE, digest);
                        if (JdbcSessionStore.PENDING.equals(cached.status()))
                            delivery.deliver(session);
                        return new FeatureResponse(
                                "1.0",
                                cached.observation(),
                                store.require(session.owner(), id).view());
                    }
                    requireNew(session, request.sequence(), request.startMs());
                    if (!session.baseline().equals(request.baselineId()))
                        throw new ContractError(409, "baseline already frozen");
                    var observation = inference.infer(request);
                    InferenceObservationValidator.require(request, observation);
                    requireModel(observation);
                    store.queue(session, JdbcSessionStore.FEATURE, digest, observation);
                    var result = delivery.deliver(store.require(session.owner(), id));
                    return new FeatureResponse("1.0", observation, result);
                });
    }

    public SessionView observe(UUID id, Observation observation) {
        return owned(
                () -> {
                    var session = store.require(current.id(), id);
                    String digest = json.fingerprint(json.tree(observation));
                    var cached = store.input(id, observation.sequence());
                    if (cached != null) {
                        requireDuplicate(cached, JdbcSessionStore.OBSERVATION, digest);
                        if (JdbcSessionStore.PENDING.equals(cached.status()))
                            delivery.deliver(session);
                        return store.require(session.owner(), id).view();
                    }
                    requireNew(session, observation.sequence(), observation.startMs());
                    requireModel(observation);
                    store.queue(session, JdbcSessionStore.OBSERVATION, digest, observation);
                    return delivery.deliver(session);
                });
    }

    /**
     * V1.1 stores no pending end; an end is acknowledged within this request or retried by the
     * client with the same {@code end_ms}. A confirmed end fixes the total for later retries.
     */
    public SessionView end(UUID id, EndSession request) {
        return owned(
                () -> {
                    var session = store.require(current.id(), id);
                    if (session.view().ended()) {
                        if (session.view().summary().totalMs() != request.endMs())
                            throw new ContractError(409, "conflicting session end");
                        return session.view();
                    }
                    if (store.pending(id) != null)
                        throw new ContractError(409, "retry pending feature request first");
                    if (request.endMs() < session.view().summary().totalMs())
                        throw new ContractError(409, "end precedes last observation");
                    return delivery.finish(session, request.endMs());
                });
    }

    public SessionView get(UUID id) {
        return store.require(current.id(), id).view();
    }

    public void delete(UUID id) {
        owned(
                () -> {
                    store.delete(current.id(), id);
                    return null;
                });
    }

    public JdbcSessionStore.Stored metadata(UUID id) {
        return store.require(current.id(), id);
    }

    private void requireSameSetup(Stored session, Policy policy, SessionSetup setup) {
        if (!session.policy().equals(policy))
            throw new ContractError(409, "policy already frozen");
        if (!session.baseline().equals(setup.baseline().baselineId())
                || !session.deviceKey().equals(setup.device().key())
                || session.frameWidth() != setup.frame().width()
                || session.frameHeight() != setup.frame().height())
            throw new ContractError(409, "session setup already frozen");
    }

    /** `monitor_session.model_version_code` is fixed at creation; outputs must match it. */
    private void requireModel(Observation observation) {
        if (!modelVersion.equals(observation.modelVersion()))
            throw new ContractError(502, "unexpected model version");
    }

    private void requireNew(Stored session, long sequence, long start) {
        if (session.view().ended()) throw new ContractError(409, "session ended or ending");
        if (store.pending(session.id()) != null)
            throw new ContractError(409, "retry pending feature request first");
        if (sequence <= session.view().lastSequence() || start < session.view().summary().totalMs())
            throw new ContractError(409, "out-of-order or overlapping interval");
        if (store.inputCount(session.id()) >= 10000)
            throw new ContractError(429, "development observation limit reached");
    }

    private void requireDuplicate(JdbcSessionStore.Input cached, String kind, String digest) {
        if (!cached.kind().equals(kind) || !cached.fingerprint().equals(digest))
            throw new ContractError(409, "conflicting duplicate");
        if (JdbcSessionStore.REJECTED.equals(cached.status()))
            throw new ContractError(cached.rejectionStatus(), "CEP rejected input");
    }

    private <T> T owned(Supplier<T> work) {
        var id = current.id();
        return locks.withLock(
                id,
                () -> {
                    users.require(id);
                    return work.get();
                });
    }
}
