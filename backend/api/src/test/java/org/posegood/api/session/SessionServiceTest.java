package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
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
import java.util.function.Supplier;

/**
 * 측정불가가 이어지면 서버가 그 지점에서 세션을 끝내고 저장한다(2026-10-26 결정). 자정 넘김은 이전 세션을 끝내고
 * 같은 설정으로 새 세션을 만든다(BE-6 ① B안). DB·추론은 가짜.
 */
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
        var locks = mock(UserLocks.class);
        when(locks.withLock(anyLong(), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
        var row = new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
        live.add(new LiveSession(row, new SessionEngine(ID, POLICY)));
        return new SessionService(live, repository, mock(BaselineRepository.class),
                mock(ThresholdPolicyRepository.class), mock(AccountService.class), inference, locks,
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

    @Test
    void midnightRolloverEndsThePreviousSessionAndStartsAFollowingOne() {
        var service = service(Duration.ZERO);
        for (long sequence = 0; sequence < 4; sequence++)
            service.features(OWNER, ID, interval(sequence, Observation.Phase.running, true));
        var midnight = Instant.parse("2026-10-26T15:00:00Z");
        when(repository.find(any(UUID.class))).thenAnswer(call -> new SessionRepository.Stored(2, call.getArgument(0),
                OWNER, POLICY, BASELINE, true, midnight, null, null, 0, 0));

        var result = service.rollover(OWNER, ID, midnight, 1000);
        // 이전 세션: 마지막 구간 끝(2초)에서 끝나 저장되고, 종료 이벤트의 closed 사유는 day_changed다.
        assertEquals(2000, result.ended().totalMs());
        assertEquals(Instant.parse("2026-10-26T01:00:02Z"), result.endedAt());
        assertTrue(service.get(OWNER, ID).ended());
        assertEquals("day_changed", published.get(published.size() - 1).closedReason());
        verify(repository).close(eq(row()), any(SessionRepository.Closing.class));
        // 새 세션: 서버가 만든 ID, 자정에 시작, 이전 세션과 같은 설정. 시간은 0부터, 한도는 받은 값(1초).
        verify(repository).insertFollowing(row(), result.sessionId(), KstTime.of(midnight));
        assertEquals(midnight, result.startedAt());
        var next = service.get(OWNER, result.sessionId());
        assertFalse(next.ended());
        assertEquals(POLICY, next.policy());
        assertEquals(500, service.features(OWNER, result.sessionId(), interval(0, Observation.Phase.running, true))
                .session().summary().totalMs());
        assertEquals(429, assertThrows(ApiError.class,
                () -> service.features(OWNER, result.sessionId(), interval(2, Observation.Phase.running, true))).status());
        // 이미 끝난 세션은 다시 넘기지 않는다.
        assertEquals("SESSION_ENDED", assertThrows(ApiError.class,
                () -> service.rollover(OWNER, ID, midnight, 1000)).code());
    }

    private static SessionRepository.Stored row() {
        return new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
    }
}
