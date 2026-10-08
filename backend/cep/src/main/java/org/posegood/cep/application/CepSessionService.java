package org.posegood.cep.application;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import org.posegood.cep.esper.EsperDecisionRuntime;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.RestoreSession;
import org.posegood.contracts.SessionView;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Owns session engine lookup, development limits, and runtime lifetime. */
@Service
public class CepSessionService {
    private static final int MAX_SESSIONS = 64;

    private final Map<UUID, SessionEngine> sessions = new ConcurrentHashMap<>();

    @PostConstruct
    void prepareRuntime() {
        // Eager bean initialization finishes before the HTTP connector starts accepting requests.
        EsperDecisionRuntime.prepare();
    }

    public synchronized SessionView create(UUID id, CreateSession request) {
        var existing = sessions.get(id);
        if (existing != null) {
            var view = existing.view();
            if (!view.policy().equals(request.policy())) {
                throw new ContractError(409, "policy already frozen");
            }
            return view;
        }
        if (sessions.size() >= MAX_SESSIONS) {
            throw new ContractError(429, "development session limit reached");
        }

        var engine = new SessionEngine(id, request.policy());
        sessions.put(id, engine);
        return engine.view();
    }

    public synchronized SessionView observe(UUID id, Observation observation) {
        return engine(id).accept(observation);
    }

    public synchronized SessionView end(UUID id, EndSession request) {
        return engine(id).end(request.endMs());
    }

    public synchronized SessionView get(UUID id) {
        return engine(id).view();
    }

    /** Rebuild off-registry; a failed replay leaves the previous engine intact. */
    public synchronized SessionView restore(UUID id, RestoreSession request) {
        var previous = sessions.get(id);
        if (previous != null && !previous.view().policy().equals(request.policy())) {
            throw new ContractError(409, "policy already frozen");
        }
        if (previous == null && sessions.size() >= MAX_SESSIONS) {
            throw new ContractError(429, "development session limit reached");
        }
        var restored = new SessionEngine(id, request.policy());
        try {
            for (var observation : request.observations()) restored.accept(observation);
            if (request.endMs() != null) restored.end(request.endMs());
            var result = restored.view();
            sessions.put(id, restored);
            if (previous != null) previous.close();
            return result;
        } catch (RuntimeException failure) {
            restored.close();
            throw failure;
        }
    }

    public synchronized void delete(UUID id) {
        var previous = sessions.remove(id);
        if (previous != null) previous.close();
    }

    private SessionEngine engine(UUID id) {
        var engine = sessions.get(id);
        if (engine == null) {
            throw new ContractError(404, "session not found");
        }
        return engine;
    }

    @PreDestroy
    public void close() {
        sessions.values().forEach(SessionEngine::close);
    }
}
