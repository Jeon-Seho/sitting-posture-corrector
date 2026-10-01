package org.posegood.cep.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.espertech.esper.runtime.client.EPRuntimeProvider;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.Policy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;

import java.util.UUID;

/** Real Spring startup prepares and destroys the temporary Esper runtime, without user sessions. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@DirtiesContext
class CepStartupTest {
    @Autowired private CepSessionService service;

    @Test
    void startupPreparationLeavesNoRuntimeAndAllSixtyFourUserSessionSlotsAvailable() {
        assertEquals(0, EPRuntimeProvider.getRuntimeURIs().length);
        var create = new CreateSession(Policy.defaults());
        for (int index = 0; index < 64; index++) {
            var view = service.create(UUID.randomUUID(), create);
            assertEquals(-1, view.lastSequence());
            assertEquals(0, view.summary().totalMs());
            assertEquals(0, view.events().size());
        }
        assertEquals(64, EPRuntimeProvider.getRuntimeURIs().length);
        assertEquals(
                429,
                assertThrows(ContractError.class, () -> service.create(UUID.randomUUID(), create))
                        .status());
    }
}
