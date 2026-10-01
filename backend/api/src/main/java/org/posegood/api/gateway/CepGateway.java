package org.posegood.api.gateway;

import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;

import java.util.UUID;

public interface CepGateway {
    SessionView create(UUID id, CreateSession request);

    SessionView observe(UUID id, Observation observation);

    SessionView end(UUID id, EndSession request);
}
