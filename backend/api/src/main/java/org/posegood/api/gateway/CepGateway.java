package org.posegood.api.gateway;

import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.RestoreSession;
import org.posegood.contracts.SessionView;

import java.util.UUID;

public interface CepGateway {
    SessionView create(UUID id, CreateSession request);

    SessionView observe(UUID id, Observation observation);

    SessionView end(UUID id, EndSession request);

    default SessionView get(UUID id) {
        throw new UnsupportedOperationException("CEP lookup unavailable");
    }

    default SessionView restore(UUID id, RestoreSession request) {
        throw new UnsupportedOperationException("CEP replay unavailable");
    }

    default void delete(UUID id) {
        throw new UnsupportedOperationException("CEP removal unavailable");
    }
}
