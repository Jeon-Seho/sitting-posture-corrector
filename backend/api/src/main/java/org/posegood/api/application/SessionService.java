package org.posegood.api.application;

import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.repository.SessionRepository;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.FeatureResponse;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** Coordinates requests and saves only verified CEP snapshots. No posture decisions belong here. */
@Service
@Profile("!persistent")
public class SessionService implements SessionOperations {
    private static final int MAX_SESSIONS = 64;

    private final SessionRepository repository;
    private final CepGateway cep;
    private final FeatureProcessor features;

    public SessionService(
            SessionRepository repository, CepGateway cep, InferenceGateway inference) {
        this.repository = repository;
        this.cep = cep;
        features = new FeatureProcessor(cep, inference);
    }

    public synchronized SessionView create(UUID id, CreateSession request) {
        var stored = repository.find(id);
        if (stored != null) {
            synchronized (stored) {
                if (!stored.view().policy().equals(request.policy())) {
                    throw new ContractError(409, "policy already frozen");
                }
                return stored.view();
            }
        }

        if (repository.size() >= MAX_SESSIONS) {
            throw new ContractError(429, "development session limit reached");
        }
        var result = cep.create(id, request);
        CepSnapshotValidator.requireIdentity(id, request.policy(), result);
        repository.saveNew(id, result);
        return result;
    }

    public SessionView observe(UUID id, Observation observation) {
        var stored = repository.require(id);
        synchronized (stored) {
            requireNoPendingFeature(stored);
            var result = cep.observe(id, observation);
            CepSnapshotValidator.requireIdentity(id, stored.view().policy(), result);
            stored.replace(result);
            return result;
        }
    }

    public FeatureResponse features(UUID id, InferenceRequest request) {
        var stored = repository.require(id);
        synchronized (stored) {
            return features.process(id, stored, request);
        }
    }

    public SessionView end(UUID id, EndSession request) {
        var stored = repository.require(id);
        synchronized (stored) {
            requireNoPendingFeature(stored);
            var result = cep.end(id, request);
            CepSnapshotValidator.requireIdentity(id, stored.view().policy(), result);
            stored.replace(result);
            return result;
        }
    }

    public SessionView get(UUID id) {
        var stored = repository.require(id);
        synchronized (stored) {
            return stored.view();
        }
    }

    private void requireNoPendingFeature(SessionRepository.StoredSession stored) {
        if (stored.pendingFeature() != null) {
            throw new ContractError(409, "retry pending feature request first");
        }
    }
}
