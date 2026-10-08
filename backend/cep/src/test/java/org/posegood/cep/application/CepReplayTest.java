package org.posegood.cep.application;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.*;

import java.util.List;
import java.util.UUID;

class CepReplayTest {
    private Observation observation(long sequence, long start, long end) {
        return new Observation(
                "2.0",
                sequence,
                start,
                end,
                Observation.Phase.running,
                true,
                .9,
                Observation.DeviationType.left_lean,
                "reference-feature-rule-v1");
    }

    @Test
    void replayRestoresIdenticalEventsAndReleaseDoesNotConsumeSlots() {
        var id = UUID.randomUUID();
        var policy = Policy.defaults();
        var first = new CepSessionService();
        var second = new CepSessionService();
        var observations =
                java.util.stream.LongStream.range(0, 63)
                        .mapToObj(n -> observation(n, n * 1000, (n + 1) * 1000))
                        .toList();
        try {
            first.create(id, new CreateSession(policy));
            for (var item : observations) first.observe(id, item);
            var ended = first.end(id, new EndSession(63000));
            assertEquals(
                    ended, second.restore(id, new RestoreSession(policy, observations, 63000L)));
            assertEquals(
                    ended, second.restore(id, new RestoreSession(policy, observations, 63000L)));
            second.delete(id);
            second.delete(id);
            assertEquals(404, assertThrows(ContractError.class, () -> second.get(id)).status());
            for (int n = 0; n < 64; n++)
                second.create(UUID.randomUUID(), new CreateSession(policy));
        } finally {
            first.close();
            second.close();
        }
    }

    @Test
    void invalidReplayLeavesExistingEngineAndClosesTemporaryRuntime() {
        var service = new CepSessionService();
        var id = UUID.randomUUID();
        try {
            var old = service.create(id, new CreateSession(Policy.defaults()));
            assertThrows(
                    ContractError.class,
                    () ->
                            service.restore(
                                    id,
                                    new RestoreSession(
                                            Policy.defaults(),
                                            List.of(
                                                    observation(1, 1000, 2000),
                                                    observation(0, 0, 1000)),
                                            null)));
            assertEquals(old, service.get(id));
            assertEquals(
                    1,
                    com.espertech.esper.runtime.client.EPRuntimeProvider.getRuntimeURIs().length);
        } finally {
            service.close();
        }
    }
}
