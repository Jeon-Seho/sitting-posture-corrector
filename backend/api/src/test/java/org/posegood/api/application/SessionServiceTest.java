package org.posegood.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.repository.SessionRepository;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.Policy;
import org.posegood.contracts.SessionView;
import org.posegood.contracts.Summary;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

class SessionServiceTest {
    private SessionView view(UUID id) {
        return new SessionView(
                "1.0",
                id,
                Policy.defaults(),
                "legacy-interrupt-v1",
                false,
                -1,
                new Summary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, 0, null, null),
                List.of());
    }

    private Observation input() {
        return new Observation(
                "2.0",
                0,
                0,
                1000,
                Observation.Phase.running,
                true,
                0.9,
                Observation.DeviationType.forward_slouch,
                "synthetic-v1");
    }

    @Test
    void createsIdempotentlyAndFreezesPolicyWithoutLocalDecisions() {
        var gateway = mock(CepGateway.class);
        var service =
                new SessionService(new SessionRepository(), gateway, mock(InferenceGateway.class));
        var id = UUID.randomUUID();
        var request = new CreateSession(Policy.defaults());
        var output = view(id);
        when(gateway.create(id, request)).thenReturn(output);
        assertEquals(output, service.create(id, request, null));
        assertEquals(output, service.create(id, request, null));
        assertThrows(
                ContractError.class,
                () -> service.create(id, new CreateSession(new Policy(4000, 2000, 60000, 0.7)), null));
        verify(gateway, times(1)).create(id, request);
        verifyNoMoreInteractions(gateway);
    }

    @Test
    void upstreamFailurePreservesSavedSnapshotAndRetryDelegates() {
        var gateway = mock(CepGateway.class);
        var service =
                new SessionService(new SessionRepository(), gateway, mock(InferenceGateway.class));
        var id = UUID.randomUUID();
        var initial = view(id);
        var request = new CreateSession(Policy.defaults());
        when(gateway.create(id, request)).thenReturn(initial);
        service.create(id, request, null);
        var input = input();
        when(gateway.observe(id, input))
                .thenThrow(new ContractError(502, "unavailable"))
                .thenReturn(initial);
        assertThrows(ContractError.class, () -> service.observe(id, input));
        assertEquals(initial, service.get(id));
        assertEquals(initial, service.observe(id, input));
        verify(gateway, times(2)).observe(id, input);
    }

    @Test
    void mismatchedSessionNeverReplacesStoredView() {
        var gateway = mock(CepGateway.class);
        var service =
                new SessionService(new SessionRepository(), gateway, mock(InferenceGateway.class));
        var id = UUID.randomUUID();
        var initial = view(id);
        var request = new CreateSession(Policy.defaults());
        when(gateway.create(id, request)).thenReturn(initial);
        service.create(id, request, null);
        when(gateway.observe(eq(id), any())).thenReturn(view(UUID.randomUUID()));
        assertThrows(ContractError.class, () -> service.observe(id, input()));
        assertEquals(initial, service.get(id));
    }

    @Test
    void unknownSessionDoesNotCallCep() {
        var gateway = mock(CepGateway.class);
        var service =
                new SessionService(new SessionRepository(), gateway, mock(InferenceGateway.class));
        assertThrows(ContractError.class, () -> service.observe(UUID.randomUUID(), input()));
        verifyNoInteractions(gateway);
    }

    @Test
    void concurrentCreationRetryWaitsForAcceptedSnapshot() throws Exception {
        var gateway = mock(CepGateway.class);
        var service =
                new SessionService(new SessionRepository(), gateway, mock(InferenceGateway.class));
        var id = UUID.randomUUID();
        var request = new CreateSession(Policy.defaults());
        var initial = view(id);
        when(gateway.create(id, request)).thenReturn(initial);
        service.create(id, request, null);
        var accepted =
                new SessionView(
                        "1.0",
                        id,
                        Policy.defaults(),
                        "legacy-interrupt-v1",
                        false,
                        0,
                        new Summary(1000, 1000, 0, 1000, 0, 0, 0, 0, 0, 0, 0.0, 0.0, 0, null, null),
                        List.of());
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(gateway.observe(eq(id), any()))
                .thenAnswer(
                        invocation -> {
                            entered.countDown();
                            if (!release.await(2, TimeUnit.SECONDS)) {
                                throw new AssertionError("test barrier timeout");
                            }
                            return accepted;
                        });
        try (var pool = Executors.newFixedThreadPool(2)) {
            var observation = pool.submit(() -> service.observe(id, input()));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var retry = pool.submit(() -> service.create(id, request, null));
            try {
                assertThrows(TimeoutException.class, () -> retry.get(100, TimeUnit.MILLISECONDS));
            } finally {
                release.countDown();
            }
            assertEquals(accepted, observation.get(2, TimeUnit.SECONDS));
            assertEquals(accepted, retry.get(2, TimeUnit.SECONDS));
        }
    }
}
