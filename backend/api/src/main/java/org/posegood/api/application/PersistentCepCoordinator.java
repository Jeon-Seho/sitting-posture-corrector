package org.posegood.api.application;

import org.posegood.api.gateway.CepGateway;
import org.posegood.api.persistence.JdbcSessionStore;
import org.posegood.api.persistence.JdbcSessionStore.Stored;
import org.posegood.contracts.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Restores the confirmed prefix before delivery; commits statistics only after verified ACK. */
@Component
@Profile("persistent")
public class PersistentCepCoordinator {
    private final JdbcSessionStore store;
    private final CepGateway cep;

    public PersistentCepCoordinator(JdbcSessionStore store, CepGateway cep) {
        this.store = store;
        this.cep = cep;
    }

    public void prepare(Stored session) {
        if (session.view().ended()) return;
        SessionView remote;
        try {
            remote = cep.get(session.id());
        } catch (ContractError error) {
            if (error.status() != 404) throw error;
            remote = null;
        }
        if (session.view().equals(remote)) return;
        // A remote state ahead of the DB can be an ACK lost before durable confirmation.
        // Rebuild exactly the durable prefix and then resend its saved pending output.
        var restored =
                cep.restore(
                        session.id(),
                        new RestoreSession(session.policy(), store.accepted(session.id()), null));
        CepSnapshotValidator.requireIdentity(session.id(), session.policy(), restored);
        if (!session.view().equals(restored))
            throw new ContractError(502, "CEP replay did not reproduce confirmed state");
    }

    public SessionView deliver(Stored session) {
        var pending = store.pending(session.id());
        if (pending == null) return session.view();
        SessionView result;
        try {
            prepare(session);
            result = cep.observe(session.id(), pending.observation());
        } catch (ContractError error) {
            if (error.status() == 409 || error.status() == 429)
                store.reject(session.id(), pending, error.status());
            throw error;
        }
        CepSnapshotValidator.requireIdentity(session.id(), session.policy(), result);
        if (result.ended()
                || result.lastSequence() != pending.observation().sequence()
                || result.summary().totalMs() != pending.observation().endMs())
            throw new ContractError(502, "CEP response did not acknowledge saved observation");
        store.confirm(session, pending, result);
        return result;
    }

    public SessionView finish(Stored session, long endMs) {
        if (session.view().ended()) return session.view();
        if (store.pending(session.id()) != null)
            throw new ContractError(409, "retry pending feature request first");
        prepare(session);
        var result = cep.end(session.id(), new EndSession(endMs));
        CepSnapshotValidator.requireIdentity(session.id(), session.policy(), result);
        if (!result.ended()
                || result.lastSequence() != session.view().lastSequence()
                || result.summary().totalMs() != endMs)
            throw new ContractError(502, "CEP response did not acknowledge saved termination");
        store.confirmEnd(session, result);
        // Durable ended snapshots need no live Esper engine. Cleanup failure is recoverable.
        try {
            cleanup(session.id());
        } catch (ContractError unavailable) {
            /* The ended engine is removed by future recovery cleanup. */
        }
        return result;
    }

    public void cleanup(java.util.UUID id) {
        cep.delete(id);
        store.cleanupComplete(id);
    }
}
