package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.contract.FeatureDeltas;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** 측정불가가 이어지면 서버가 그 지점에서 세션을 끝내고 저장한다(2026-10-26 결정). DB·추론은 가짜. */
class SessionServiceTest {
    private static final long OWNER = 7;
    private static final UUID ID = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
    private static final UUID BASELINE = UUID.fromString("9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60");
    private static final Policy POLICY = new Policy(3000, 3000, 60000, 0.7);

    private final SessionRepository repository = mock(SessionRepository.class);
    private final InferenceClient inference = mock(InferenceClient.class);
    private final List<SessionUpdates.Progressed> published = new ArrayList<>();

    private SessionService service(Duration unmeasurableTimeout) {
        ApplicationEventPublisher events = event -> {
            if (event instanceof SessionUpdates.Progressed progressed) published.add(progressed);
        };
        var tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(null));
        when(inference.infer(any(InferenceRequest.class))).thenAnswer(call -> {
            InferenceRequest request = call.getArgument(0);
            boolean valid = request.measurementQuality() == InferenceRequest.MeasurementQuality.good;
            return new Observation("2.0", request.sequence(), request.startMs(), request.endMs(), request.phase(),
                    valid, valid ? 0.1 : 0, Observation.DeviationType.none,
                    "synthetic-v1");
        });
        var live = new LiveSessions(events, 8, Duration.ofMinutes(30), Duration.ofHours(6));
        var row = new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
        live.add(new LiveSession(row, new SessionEngine(ID, POLICY)));
        return new SessionService(live, repository, mock(BaselineRepository.class),
                mock(ThresholdPolicyRepository.class), mock(AccountService.class), inference, mock(UserLocks.class),
                tx, events, Duration.ofHours(24), unmeasurableTimeout);
    }

    private static InferenceRequest interval(long sequence, Observation.Phase phase, boolean valid) {
        return new InferenceRequest("2.0", "shoulder-relative-deltas-v1", BASELINE, sequence, sequence * 500,
                (sequence + 1) * 500, phase,
                valid ? InferenceRequest.MeasurementQuality.good : InferenceRequest.MeasurementQuality.poor,
                valid ? new FeatureDeltas(0, 0, 0, 1, 1) : null);
    }

    @Test
    void unmeasurableForTheTimeoutEndsAndStoresTheSessionAtThatPoint() {
        var service = service(Duration.ofSeconds(5));
        service.features(OWNER, ID, interval(0, Observation.Phase.running, true));
        // 판정 불가 3초 + 자리 비움 2초 = 5초가 차는 구간에서 끝난다.
        for (long sequence = 1; sequence <= 6; sequence++)
            assertFalse(service.features(OWNER, ID, interval(sequence, Observation.Phase.running, false)).session().ended());
        for (long sequence = 7; sequence <= 9; sequence++)
            assertFalse(service.features(OWNER, ID, interval(sequence, Observation.Phase.away, false)).session().ended());
        var last = service.features(OWNER, ID, interval(10, Observation.Phase.away, false)).session();
        assertTrue(last.ended());
        assertEquals(5500, last.summary().totalMs());
        assertEquals("session_ended", last.events().get(last.events().size() - 1).kind());

        var update = published.get(published.size() - 1);
        assertTrue(update.ended());
        assertEquals("unmeasurable_timeout", update.closedReason());
        verify(repository).close(eq(row()), any(SessionRepository.Closing.class));
    }

    @Test
    void restResetsTheCountAndZeroTurnsTheRuleOff() {
        var service = service(Duration.ofSeconds(5));
        for (long sequence = 0; sequence < 9; sequence++)
            service.features(OWNER, ID, interval(sequence, Observation.Phase.running, false));
        service.features(OWNER, ID, interval(9, Observation.Phase.rest, false)); // 쉬기는 초기화
        for (long sequence = 10; sequence < 19; sequence++)
            assertFalse(service.features(OWNER, ID, interval(sequence, Observation.Phase.running, false)).session().ended());

        published.clear();
        var off = service(Duration.ZERO);
        for (long sequence = 0; sequence < 40; sequence++)
            assertFalse(off.features(OWNER, ID, interval(sequence, Observation.Phase.away, false)).session().ended());
        assertNull(published.get(published.size() - 1).closedReason());
        verify(repository, never()).close(any(), any());
    }

    private static SessionRepository.Stored row() {
        return new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
    }
}
