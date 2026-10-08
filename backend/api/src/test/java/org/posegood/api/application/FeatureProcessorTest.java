package org.posegood.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.repository.SessionRepository;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.FeatureDeltas;
import org.posegood.contracts.InferenceRequest;
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

/** Explicit synthetic features only; these tests exercise ordering, not posture classification. */
class FeatureProcessorTest {
    private static final UUID BASELINE = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final FeatureDeltas DELTAS = new FeatureDeltas(0, 0.2, 0, 0.9, 0.9);

    private static InferenceRequest request(long sequence, long startMs) {
        return request(sequence, startMs, BASELINE, DELTAS);
    }

    private static InferenceRequest request(
            long sequence, long startMs, UUID baseline, FeatureDeltas deltas) {
        return new InferenceRequest(
                "2.0",
                "shoulder-relative-deltas-v1",
                baseline,
                sequence,
                startMs,
                startMs + 1000,
                Observation.Phase.running,
                InferenceRequest.MeasurementQuality.good,
                deltas);
    }

    private static Observation observation(InferenceRequest request) {
        return new Observation(
                "2.0",
                request.sequence(),
                request.startMs(),
                request.endMs(),
                request.phase(),
                true,
                0.7,
                Observation.DeviationType.left_lean,
                "reference-feature-rule-v1");
    }

    private static SessionView view(UUID id, long sequence, long totalMs, boolean ended) {
        return new SessionView(
                "1.0",
                id,
                Policy.defaults(),
                "legacy-interrupt-v1",
                ended,
                sequence,
                new Summary(
                        totalMs,
                        totalMs,
                        0,
                        totalMs,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        totalMs == 0 ? null : 0.0,
                        totalMs == 0 ? null : 0.0,
                        0,
                        null,
                        null),
                List.of());
    }

    private static class Fixture {
        final UUID id = UUID.randomUUID();
        final CepGateway cep = mock(CepGateway.class);
        final InferenceGateway inference = mock(InferenceGateway.class);
        final SessionRepository repository = new SessionRepository();
        final SessionService service = new SessionService(repository, cep, inference);
        final SessionView initial = view(id, -1, 0, false);

        Fixture() {
            repository.saveNew(id, initial);
        }

        SessionView accept(InferenceRequest request) {
            var output = observation(request);
            var accepted = view(id, request.sequence(), request.endMs(), false);
            when(inference.infer(request)).thenReturn(output);
            when(cep.observe(id, output)).thenReturn(accepted);
            return accepted;
        }
    }

    @Test
    void acceptedRetryReusesOutputAndHistoricalRetryReturnsLatestSnapshot() {
        var fixture = new Fixture();
        var first = request(0, 0);
        var firstView = fixture.accept(first);
        var response = fixture.service.features(fixture.id, first);
        assertEquals("1.0", response.schemaVersion());
        assertEquals(firstView, response.session());
        assertEquals(response, fixture.service.features(fixture.id, first));
        var second = request(1, 1000);
        var latest = fixture.accept(second);
        fixture.service.features(fixture.id, second);
        var historical = fixture.service.features(fixture.id, first);
        assertEquals(observation(first), historical.observation());
        assertEquals(latest, historical.session());
        verify(fixture.inference, times(1)).infer(first);
        verify(fixture.cep, times(1)).observe(fixture.id, observation(first));
        var order = inOrder(fixture.inference, fixture.cep);
        order.verify(fixture.inference).infer(first);
        order.verify(fixture.cep).observe(fixture.id, observation(first));
    }

    @Test
    void changedDuplicateAndFrozenBaselineFailBeforeInference() {
        var fixture = new Fixture();
        var first = request(0, 0);
        fixture.accept(first);
        fixture.service.features(fixture.id, first);
        clearInvocations(fixture.inference, fixture.cep);
        var changed = request(0, 0, BASELINE, new FeatureDeltas(0, -0.2, 0, 0.9, 0.9));
        assertEquals(
                409,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, changed))
                        .status());
        var baselineChange = request(1, 1000, UUID.randomUUID(), DELTAS);
        assertEquals(
                409,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, baselineChange))
                        .status());
        verifyNoInteractions(fixture.inference, fixture.cep);
    }

    @Test
    void uncertainCepFailureRetainsOutputForExactRetryAndBlocksOtherRoutes() {
        var fixture = new Fixture();
        var request = request(0, 0);
        var output = observation(request);
        var accepted = fixture.accept(request);
        when(fixture.cep.observe(fixture.id, output))
                .thenThrow(new ContractError(502, "unavailable"))
                .thenReturn(accepted);
        assertEquals(
                502,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, request))
                        .status());
        assertEquals(fixture.initial, fixture.service.get(fixture.id));
        assertEquals(BASELINE, fixture.repository.require(fixture.id).featureBaselineId());
        assertEquals(
                409,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, request(1, 1000)))
                        .status());
        assertEquals(
                409,
                assertThrows(ContractError.class, () -> fixture.service.observe(fixture.id, output))
                        .status());
        assertEquals(
                409,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.end(fixture.id, new EndSession(0)))
                        .status());
        assertEquals(fixture.initial, fixture.service.get(fixture.id));
        assertEquals(accepted, fixture.service.features(fixture.id, request).session());
        verify(fixture.inference, times(1)).infer(request);
        verify(fixture.cep, times(2)).observe(fixture.id, output);
        verify(fixture.cep, times(0)).end(any(), any());
    }

    @Test
    void definiteCepRefusalRemainsIdempotentAndAllowsEnd() {
        for (var status : List.of(409, 429)) {
            var fixture = new Fixture();
            var request = request(0, 0);
            fixture.accept(request);
            when(fixture.cep.observe(fixture.id, observation(request)))
                    .thenThrow(new ContractError(status, "definite refusal"));
            for (int attempt = 0; attempt < 2; attempt++) {
                assertEquals(
                        status,
                        assertThrows(
                                        ContractError.class,
                                        () -> fixture.service.features(fixture.id, request))
                                .status());
            }
            assertEquals(fixture.initial, fixture.service.get(fixture.id));
            var end = new EndSession(0);
            var ended = view(fixture.id, -1, 0, true);
            when(fixture.cep.end(fixture.id, end)).thenReturn(ended);
            assertEquals(ended, fixture.service.end(fixture.id, end));
            verify(fixture.inference, times(1)).infer(request);
            verify(fixture.cep, times(1)).observe(fixture.id, observation(request));
        }
    }

    @Test
    void inferenceFailureDoesNotFreezeBaselineOrModifySnapshot() {
        var fixture = new Fixture();
        var failed = request(0, 0);
        when(fixture.inference.infer(failed)).thenThrow(new ContractError(502, "unavailable"));
        assertThrows(ContractError.class, () -> fixture.service.features(fixture.id, failed));
        assertEquals(fixture.initial, fixture.service.get(fixture.id));
        assertEquals(null, fixture.repository.require(fixture.id).featureBaselineId());
        verifyNoInteractions(fixture.cep);
        var replacement = request(0, 0, UUID.randomUUID(), DELTAS);
        var accepted = fixture.accept(replacement);
        assertEquals(accepted, fixture.service.features(fixture.id, replacement).session());
    }

    @Test
    void malformedInferenceIdentityNeverReachesCepOrFreezesBaseline() {
        var request = request(0, 0);
        var malformed =
                List.of(
                        new Observation(
                                "2.0",
                                1,
                                0,
                                1000,
                                Observation.Phase.running,
                                true,
                                0.7,
                                Observation.DeviationType.left_lean,
                                "reference-feature-rule-v1"),
                        new Observation(
                                "2.0",
                                0,
                                1,
                                1000,
                                Observation.Phase.running,
                                true,
                                0.7,
                                Observation.DeviationType.left_lean,
                                "reference-feature-rule-v1"),
                        new Observation(
                                "2.0",
                                0,
                                0,
                                1000,
                                Observation.Phase.running,
                                true,
                                0.7,
                                Observation.DeviationType.left_lean,
                                "unexpected-model"),
                        new Observation(
                                "2.0",
                                0,
                                0,
                                1000,
                                Observation.Phase.running,
                                false,
                                0.7,
                                Observation.DeviationType.left_lean,
                                "reference-feature-rule-v1"),
                        new Observation(
                                "2.0",
                                0,
                                0,
                                1000,
                                Observation.Phase.running,
                                true,
                                1.1,
                                Observation.DeviationType.left_lean,
                                "reference-feature-rule-v1"));
        for (var output : malformed) {
            var fixture = new Fixture();
            when(fixture.inference.infer(request)).thenReturn(output);
            assertEquals(
                    502,
                    assertThrows(
                                    ContractError.class,
                                    () -> fixture.service.features(fixture.id, request))
                            .status());
            assertEquals(fixture.initial, fixture.service.get(fixture.id));
            assertEquals(0, fixture.repository.require(fixture.id).featureResultCount());
            verifyNoInteractions(fixture.cep);
        }
    }

    @Test
    void falseValidResponseForLowCurrentOrBaselineQualityNeverReachesCep() {
        for (var deltas :
                List.of(
                        new FeatureDeltas(0, 0.2, 0, 0.649999, 0.9),
                        new FeatureDeltas(0, 0.2, 0, 0.9, 0.649999))) {
            var fixture = new Fixture();
            var request = request(0, 0, BASELINE, deltas);
            when(fixture.inference.infer(request)).thenReturn(observation(request));
            assertEquals(
                    502,
                    assertThrows(
                                    ContractError.class,
                                    () -> fixture.service.features(fixture.id, request))
                            .status());
            assertEquals(fixture.initial, fixture.service.get(fixture.id));
            assertEquals(0, fixture.repository.require(fixture.id).featureResultCount());
            assertEquals(null, fixture.repository.require(fixture.id).featureBaselineId());
            verifyNoInteractions(fixture.cep);
        }
    }

    @Test
    void missingInferenceOutputIsRejected() {
        var fixture = new Fixture();
        assertEquals(
                502,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, request(0, 0)))
                        .status());
        verifyNoInteractions(fixture.cep);
    }

    @Test
    void cepAcknowledgementMismatchKeepsOriginalSnapshotAndPendingOutput() {
        var fixture = new Fixture();
        var request = request(0, 0);
        fixture.accept(request);
        when(fixture.cep.observe(fixture.id, observation(request))).thenReturn(fixture.initial);
        assertEquals(
                502,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, request))
                        .status());
        assertEquals(fixture.initial, fixture.service.get(fixture.id));
        var accepted = view(fixture.id, 0, 1000, false);
        when(fixture.cep.observe(fixture.id, observation(request))).thenReturn(accepted);
        assertEquals(accepted, fixture.service.features(fixture.id, request).session());
        verify(fixture.inference, times(1)).infer(request);
    }

    @Test
    void unknownEndedOutOfOrderAndOverlapFailBeforeInference() {
        var fixture = new Fixture();
        assertEquals(
                404,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(UUID.randomUUID(), request(0, 0)))
                        .status());
        fixture.repository.require(fixture.id).replace(view(fixture.id, 3, 4000, false));
        for (var rejected : List.of(request(3, 4000), request(4, 3999))) {
            assertEquals(
                    409,
                    assertThrows(
                                    ContractError.class,
                                    () -> fixture.service.features(fixture.id, rejected))
                            .status());
        }
        fixture.repository.require(fixture.id).replace(view(fixture.id, 3, 4000, true));
        assertEquals(
                409,
                assertThrows(
                                ContractError.class,
                                () -> fixture.service.features(fixture.id, request(4, 4000)))
                        .status());
        verifyNoInteractions(fixture.inference, fixture.cep);
    }

    @Test
    void acceptedDuplicateStillWorksAfterEnd() {
        var fixture = new Fixture();
        var request = request(0, 0);
        fixture.accept(request);
        fixture.service.features(fixture.id, request);
        var ended = view(fixture.id, 0, 1000, true);
        fixture.repository.require(fixture.id).replace(ended);
        assertEquals(ended, fixture.service.features(fixture.id, request).session());
        verify(fixture.inference, times(1)).infer(request);
        verify(fixture.cep, times(1)).observe(fixture.id, observation(request));
    }

    @Test
    void cacheLimitRejectsBeforeInferenceAndDoesNotBlockEnd() {
        var fixture = new Fixture();
        var stored = fixture.repository.require(fixture.id);
        for (int sequence = 0; sequence < 10000; sequence++) {
            var request = request(sequence, sequence * 1000L);
            stored.cacheFeature(
                    BASELINE, FeatureRequestFingerprint.of(request), observation(request));
            stored.clearPendingFeature();
        }
        stored.replace(view(fixture.id, 9999, 10000000, false));
        assertEquals(
                429,
                assertThrows(
                                ContractError.class,
                                () ->
                                        fixture.service.features(
                                                fixture.id, request(10000, 10000000)))
                        .status());
        verifyNoInteractions(fixture.inference, fixture.cep);
        var end = new EndSession(10000000);
        var ended = view(fixture.id, 9999, 10000000, true);
        when(fixture.cep.end(fixture.id, end)).thenReturn(ended);
        assertEquals(ended, fixture.service.end(fixture.id, end));
        assertEquals(10000, stored.featureResultCount());
    }

    @Test
    void concurrentExactRetryWaitsAndCallsBothUpstreamsOnce() throws Exception {
        var fixture = new Fixture();
        var request = request(0, 0);
        var accepted = fixture.accept(request);
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(fixture.inference.infer(request))
                .thenAnswer(
                        invocation -> {
                            entered.countDown();
                            if (!release.await(2, TimeUnit.SECONDS)) {
                                throw new AssertionError("test barrier timeout");
                            }
                            return observation(request);
                        });
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> fixture.service.features(fixture.id, request));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var retry = pool.submit(() -> fixture.service.features(fixture.id, request));
            try {
                assertThrows(TimeoutException.class, () -> retry.get(100, TimeUnit.MILLISECONDS));
            } finally {
                release.countDown();
            }
            assertEquals(accepted, first.get(2, TimeUnit.SECONDS).session());
            assertEquals(first.get(), retry.get(2, TimeUnit.SECONDS));
        }
        verify(fixture.inference, times(1)).infer(request);
        verify(fixture.cep, times(1)).observe(fixture.id, observation(request));
    }
}
