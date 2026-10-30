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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/**
 * 측정불가가 이어지면 서버가 그 지점에서 세션을 끝내고 저장한다(2026-10-26 결정). 자정 넘김은 이전 세션을 끝내고
 * 같은 설정으로 새 세션을 만든다(BE-6 ① B안). 입력은 실시간 v2 좌표 구간({@link SessionService#frames}). 받은 구간은
 * 서버 시계로 묶었다가 프레임마다 판정한다(계획 0064). DB·추론은 가짜.
 */
class SessionServiceTest {
    private static final long OWNER = 7;
    private static final UUID ID = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
    private static final UUID BASELINE = UUID.fromString("9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60");
    private static final Policy POLICY = new Policy(3000, 3000, 60000, 0.7);

    private final SessionRepository repository = mock(SessionRepository.class);
    private final InferenceClient inference = mock(InferenceClient.class);
    private final List<SessionUpdates.Progressed> published = new ArrayList<>();
    /** 켜면 가짜 추론이 502로 실패한다. */
    private final AtomicBoolean failing = new AtomicBoolean();

    /** 받을 때마다 판정한다(batch-window 0). */
    private SessionService service(Duration unmeasurableTimeout) {
        return service(unmeasurableTimeout, Duration.ZERO);
    }

    private SessionService service(Duration unmeasurableTimeout, Duration batchWindow) {
        ApplicationEventPublisher events = event -> {
            if (event instanceof SessionUpdates.Progressed progressed) published.add(progressed);
        };
        var tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(null));
        // 가짜 추론 v3: 사람이 있는 프레임은 점수 0.1(좋음), 없거나 앱이 판정 불가로 표시한 프레임은 판정 불가.
        when(inference.infer(any(FrameInference.Request.class))).thenAnswer(call -> {
            if (failing.get()) throw ApiError.upstream("synthetic inference failure");
            FrameInference.Request request = call.getArgument(0);
            var results = request.frames().stream()
                    .map(frame -> frame.tracked()
                            ? new FrameInference.Result(frame.tMs(), true, 0.1, Observation.DeviationType.none, null)
                            : new FrameInference.Result(frame.tMs(), false, 0, Observation.DeviationType.none,
                                    "unmeasurable"))
                    .toList();
            return new FrameInference.Response("3.0", "synthetic-v1", results);
        });
        when(inference.modelVersion()).thenReturn("synthetic-v1");
        var live = new LiveSessions(events, 8, Duration.ofMinutes(30), Duration.ofHours(6));
        var locks = mock(UserLocks.class);
        when(locks.withLock(anyLong(), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
        var row = new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
        live.add(new LiveSession(row, new SessionEngine(ID, POLICY)));
        return new SessionService(live, repository, mock(BaselineRepository.class),
                mock(ThresholdPolicyRepository.class), mock(AccountService.class), inference, locks,
                tx, events, Duration.ofHours(24), unmeasurableTimeout, batchWindow);
    }

    /** 합성 기준 좌표(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨). */
    private static final double[][] UPRIGHT = {
        {0.51234, 0.40211}, {0.53011, 0.3712}, {0.49012, 0.372}, {0.56021, 0.39012}, {0.46011, 0.391},
        {0.52, 0.44}, {0.5, 0.44}, {0.66011, 0.62}, {0.36012, 0.62}
    };
    private static final SessionRequests.Landmarks BASELINE_POINTS = landmarks();

    private static SessionRequests.Landmarks landmarks() {
        var p = new SessionRequests.Point[9];
        for (int i = 0; i < 9; i++) p[i] = new SessionRequests.Point(UPRIGHT[i][0], UPRIGHT[i][1]);
        return new SessionRequests.Landmarks(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
    }

    /** 0.5초 좌표 구간. 판정 가능하면 기준과 같은 자세 1장, 아니면 사람 없는 프레임 1장, 쉬기·자리 비움은 빈 구간. */
    private static FrameInterval interval(long sequence, FrameInterval.Phase phase, boolean valid) {
        long start = sequence * 500;
        List<FrameInterval.Frame> frames = List.of();
        if (phase == FrameInterval.Phase.running) {
            List<List<Double>> p = null;
            if (valid) {
                p = new ArrayList<>();
                for (var joint : UPRIGHT) p.add(List.of(joint[0], joint[1], 0.95));
            }
            frames = List.of(new FrameInterval.Frame(start, p, null));
        }
        return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, start + 500, phase, frames);
    }

    /** 프레임이 {@code times}에 찍힌 구간. {@code tracked}가 false인 프레임은 사람이 없다. */
    private static FrameInterval interval(long sequence, long start, long end, long[] times, boolean[] tracked) {
        var frames = new ArrayList<FrameInterval.Frame>();
        for (int index = 0; index < times.length; index++) {
            List<List<Double>> p = null;
            if (tracked[index]) {
                p = new ArrayList<>();
                for (var joint : UPRIGHT) p.add(List.of(joint[0], joint[1], 0.95));
            }
            frames.add(new FrameInterval.Frame(times[index], p, null));
        }
        return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, end, FrameInterval.Phase.running, frames);
    }

    /** 실시간 v2 구간 하나를 넣고(묶음을 넘길 때면 판정) 세션 조회 응답을 돌려준다. */
    private static SessionView feed(SessionService service, UUID id, FrameInterval interval) {
        service.frames(OWNER, id, interval, BASELINE_POINTS);
        service.flush(OWNER, id);
        return service.get(OWNER, id);
    }

    private SessionUpdates.Progressed lastBatch() {
        for (int index = published.size() - 1; index >= 0; index--)
            if (published.get(index).live() != null) return published.get(index);
        throw new AssertionError("no batch was judged");
    }

    @Test
    void intervalsWaitForTheWindowAndEndJudgesTheRestFrameByFrame() {
        var service = service(Duration.ZERO, Duration.ofSeconds(3));
        for (long sequence = 0; sequence < 3; sequence++)
            assertEquals(0, feed(service, ID, interval(sequence, FrameInterval.Phase.running, true)).summary().totalMs());
        verify(inference, never()).infer(any(FrameInference.Request.class));
        // 같은 순번·앞선 순번은 묶음에 있어도 409다.
        assertEquals(409, assertThrows(ApiError.class,
                () -> service.frames(OWNER, ID, interval(2, FrameInterval.Phase.running, true), BASELINE_POINTS)).status());

        service.finish(OWNER, ID, null); // 끊김·종료는 기다리지 않고 남은 묶음을 판정한 뒤 끝낸다
        verify(inference, times(1)).infer(any(FrameInference.Request.class));
        var view = service.get(OWNER, ID);
        assertTrue(view.ended());
        assertEquals(1500, view.summary().totalMs());
        assertEquals(1500, view.summary().validMs());
        var batch = lastBatch();
        assertEquals(new Observation.V4("4.0", true, "good", 0.1, null), batch.live());
        assertEquals(2, batch.lastSequence());
    }

    @Test
    void restOrAwaySendsTheBatchAtOnce() {
        var service = service(Duration.ZERO, Duration.ofSeconds(3));
        feed(service, ID, interval(0, FrameInterval.Phase.running, true));
        feed(service, ID, interval(1, FrameInterval.Phase.running, false));
        assertTrue(published.isEmpty());
        var view = feed(service, ID, interval(2, FrameInterval.Phase.rest, false));
        assertEquals(1500, view.summary().totalMs());
        assertEquals(500, view.summary().restMs());
        // 마지막 판정 가능 프레임은 순번 0의 것이다(순번 1은 사람이 없었다).
        assertEquals(new Observation.V4("4.0", true, "good", 0.1, null), lastBatch().live());
        assertEquals("rest", lastBatch().pausedReason());
    }

    @Test
    void onlyJudgeableFrameTimeIsValidAndOneFrameCoversAtMostHalfASecond() {
        var service = service(Duration.ZERO);
        // 0·200ms 프레임은 다음 프레임까지, 100ms 프레임은 사람이 없다. 200ms 프레임은 0.5초까지만(200~700) 판정한다.
        var view = feed(service, ID, interval(0, 0, 1000, new long[] {0, 100, 200}, new boolean[] {true, false, true}));
        assertEquals(1000, view.summary().totalMs());
        assertEquals(600, view.summary().validMs());
        assertEquals(400, view.summary().unknownMs());
        // 구간의 마지막 300ms는 판정 불가라 멈춘 이유는 unmeasurable이다. 관측 4.0은 마지막 판정 가능 프레임(200ms)이다.
        assertEquals("unmeasurable", lastBatch().pausedReason());
        assertTrue(lastBatch().live().valid());
    }

    @Test
    void aFailedBatchIsDroppedAndItsTimeBecomesMissing() {
        var service = service(Duration.ZERO);
        feed(service, ID, interval(0, FrameInterval.Phase.running, true));
        failing.set(true);
        service.frames(OWNER, ID, interval(1, FrameInterval.Phase.running, true), BASELINE_POINTS);
        assertEquals(502, assertThrows(ApiError.class, () -> service.flush(OWNER, ID)).status());
        failing.set(false);
        var view = feed(service, ID, interval(2, FrameInterval.Phase.running, true));
        assertEquals(1500, view.summary().totalMs());
        assertEquals(500, view.summary().missingMs());
        assertEquals(1000, view.summary().validMs());
    }

    @Test
    void anUnmeasurableBatchSaysWhy() {
        var service = service(Duration.ZERO);
        feed(service, ID, interval(0, FrameInterval.Phase.running, false));
        assertEquals(new Observation.V4("4.0", false, null, 0, "unmeasurable"), lastBatch().live());
        assertEquals("unmeasurable", lastBatch().pausedReason());
    }

    @Test
    void unmeasurableForTheTimeoutEndsAndStoresTheSessionAtThatPoint() {
        var service = service(Duration.ofSeconds(5));
        feed(service, ID, interval(0, FrameInterval.Phase.running, true));
        // 판정 불가 3초 + 자리 비움 2초 = 5초가 차는 구간에서 끝난다.
        for (long sequence = 1; sequence <= 6; sequence++)
            assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.running, false)).ended());
        for (long sequence = 7; sequence <= 9; sequence++)
            assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.away, false)).ended());
        var last = feed(service, ID, interval(10, FrameInterval.Phase.away, false));
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
            feed(service, ID, interval(sequence, FrameInterval.Phase.running, false));
        feed(service, ID, interval(9, FrameInterval.Phase.rest, false)); // 쉬기는 초기화
        for (long sequence = 10; sequence < 19; sequence++)
            assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.running, false)).ended());

        published.clear();
        var off = service(Duration.ZERO);
        for (long sequence = 0; sequence < 40; sequence++)
            assertFalse(feed(off, ID, interval(sequence, FrameInterval.Phase.away, false)).ended());
        assertNull(published.get(published.size() - 1).closedReason());
        verify(repository, never()).close(any(), any());
    }

    @Test
    void midnightRolloverEndsThePreviousSessionAndStartsAFollowingOne() {
        var service = service(Duration.ZERO);
        for (long sequence = 0; sequence < 4; sequence++)
            feed(service, ID, interval(sequence, FrameInterval.Phase.running, true));
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
        assertEquals(500, feed(service, result.sessionId(), interval(0, FrameInterval.Phase.running, true))
                .summary().totalMs());
        assertEquals(429, assertThrows(ApiError.class,
                () -> feed(service, result.sessionId(), interval(2, FrameInterval.Phase.running, true))).status());
        // 이미 끝난 세션은 다시 넘기지 않는다.
        assertEquals("SESSION_ENDED", assertThrows(ApiError.class,
                () -> service.rollover(OWNER, ID, midnight, 1000)).code());
    }

    private static SessionRepository.Stored row() {
        return new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
                Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
    }
}
