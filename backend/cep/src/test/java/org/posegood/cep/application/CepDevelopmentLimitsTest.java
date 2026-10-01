package org.posegood.cep.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.Policy;
import org.posegood.contracts.SessionView;

import java.util.ArrayList;
import java.util.UUID;

/**
 * Exercises real Esper sessions with synthetic inputs; no expiry or deletion policy is introduced.
 */
class CepDevelopmentLimitsTest {
    @Test
    void sixtyFourRetainedSessionsRejectNewSessionButPermitExistingRetriesAndEnd() {
        var service = new CepSessionService();
        var ids = new ArrayList<UUID>();
        var endedViews = new ArrayList<SessionView>();
        var create = new CreateSession(Policy.defaults());
        var input =
                new Observation(
                        "2.0",
                        0,
                        0,
                        1000,
                        Observation.Phase.running,
                        true,
                        0.1,
                        Observation.DeviationType.none,
                        "synthetic-v1");
        try {
            for (int index = 0; index < 64; index++) {
                var id = UUID.randomUUID();
                ids.add(id);
                service.create(id, create);
                service.observe(id, input);
                endedViews.add(service.end(id, new EndSession(1000)));
            }
            assertEquals(
                    429,
                    assertThrows(
                                    ContractError.class,
                                    () -> service.create(UUID.randomUUID(), create))
                            .status());
            for (int index = 0; index < ids.size(); index++) {
                var id = ids.get(index);
                var ended = endedViews.get(index);
                assertEquals(ended, service.get(id));
                assertEquals(ended, service.create(id, create));
                assertEquals(ended, service.observe(id, input));
                assertEquals(ended, service.end(id, new EndSession(1000)));
                assertEquals(1, ended.events().size());
                assertEquals("session_ended", ended.events().getFirst().kind());
            }
        } finally {
            service.close();
        }
    }
}
