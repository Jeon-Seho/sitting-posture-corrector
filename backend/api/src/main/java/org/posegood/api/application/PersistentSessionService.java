package org.posegood.api.application;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.account.UserStore;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.persistence.JdbcSessionStore;
import org.posegood.api.persistence.JdbcSessionStore.Stored;
import org.posegood.api.persistence.JsonCodec;
import org.posegood.api.persistence.UserLocks;
import org.posegood.contracts.*;
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

    public PersistentSessionService(
            JdbcSessionStore store,
            InferenceGateway inference,
            PersistentCepCoordinator delivery,
            CurrentUser current,
            UserStore users,
            UserLocks locks,
            JsonCodec json) {
        this.store = store;
        this.inference = inference;
        this.delivery = delivery;
        this.current = current;
        this.users = users;
        this.locks = locks;
        this.json = json;
    }

    public SessionView create(UUID id, CreateSession request) {
        return owned(
                () -> {
                    UUID owner = current.id();
                    var existing = store.find(id);
                    if (existing != null) {
                        existing = store.require(owner, id);
                        if (!existing.policy().equals(request.policy()))
                            throw new ContractError(409, "policy already frozen");
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
                    var session = store.create(owner, id, request.policy(), empty);
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
                        requireDuplicate(cached, "feature", digest);
                        if ("pending".equals(cached.status())) delivery.deliver(session);
                        return new FeatureResponse(
                                "1.0",
                                cached.observation(),
                                store.require(session.owner(), id).view());
                    }
                    requireNew(session, request.sequence(), request.startMs());
                    if (session.baseline() != null
                            && !session.baseline().equals(request.baselineId()))
                        throw new ContractError(409, "baseline already frozen");
                    var observation = inference.infer(request);
                    InferenceObservationValidator.require(request, observation);
                    store.queue(session, "feature", digest, request.baselineId(), observation);
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
                        requireDuplicate(cached, "observation", digest);
                        if ("pending".equals(cached.status())) delivery.deliver(session);
                        return store.require(session.owner(), id).view();
                    }
                    requireNew(session, observation.sequence(), observation.startMs());
                    store.queue(session, "observation", digest, null, observation);
                    return delivery.deliver(session);
                });
    }

    public SessionView end(UUID id, EndSession request) {
        return owned(
                () -> {
                    var session = store.require(current.id(), id);
                    if (store.pending(id) != null)
                        throw new ContractError(409, "retry pending feature request first");
                    if (request.endMs() < session.view().summary().totalMs())
                        throw new ContractError(409, "end precedes last observation");
                    if (session.endMs() != null && session.endMs() != request.endMs())
                        throw new ContractError(409, "conflicting session end");
                    if (session.view().ended()) return session.view();
                    store.queueEnd(id, request.endMs());
                    return delivery.finish(store.require(session.owner(), id));
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

    private void requireNew(Stored session, long sequence, long start) {
        if (session.view().ended() || session.endMs() != null)
            throw new ContractError(409, "session ended or ending");
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
        if ("rejected".equals(cached.status()))
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
