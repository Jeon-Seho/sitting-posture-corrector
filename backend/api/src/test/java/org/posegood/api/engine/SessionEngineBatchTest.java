package org.posegood.api.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * 판정 엔진이 모으는 묶음(계획 0084): 자리 잡기 → 결과 채우기(순서와 상관없이) → 서버 시계로 앞에서부터 판정.
 *
 * 시각은 가짜 서버 시계(나노초 숫자)이고 좌표·결과는 합성이다.
 */
class SessionEngineBatchTest {
    private static final Policy POLICY = new Policy(3000, 2000, 60000, 0.7);
    private static final String MODEL = "synthetic-v1";
    private static final long SECOND = 1_000_000_000L;
    private static final long WINDOW = 3 * SECOND;
    private static final long WAIT = 2 * SECOND;

    private final SessionEngine engine = new SessionEngine(UUID.randomUUID(), POLICY);

    /** 0.5초 구간 하나에 프레임 1장(구간 시작에 찍힘). */
    private static FrameInterval running(long sequence) {
        long start = sequence * 500;
        return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, start + 500, FrameInterval.Phase.running,
                List.of(new FrameInterval.Frame(start, null, null)));
    }

    private static FrameInterval phase(long sequence, FrameInterval.Phase phase) {
        long start = sequence * 500;
        return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, start + 500, phase, List.of());
    }

    private static List<FrameInference.Result> score(long sequence, double probability) {
        return List.of(new FrameInference.Result(sequence * 500, true, probability, Observation.DeviationType.none, null));
    }

    private void hold(long sequence, long now) {
        assertTrue(engine.hold(running(sequence), now));
    }

    @Test
    void resultsArriveOutOfOrderButAreJudgedInOrder() {
        for (long sequence = 0; sequence < 3; sequence++) hold(sequence, 0);
        engine.fill(2, score(2, 0.9), MODEL);
        engine.fill(0, score(0, 0.1), MODEL);
        // 순번 1이 아직이다(결과 대기 시간 안): 순번 0까지만 판정하고 1을 기다린다.
        var first = engine.judge(SECOND / 2, WAIT, false, 0);
        assertEquals(1, first.judged());
        assertEquals(0, engine.lastSequence());
        assertEquals(500, engine.summary().validMs());
        // 기다리던 결과가 오면 3초를 다시 기다리지 않고 판정할 때다.
        assertFalse(engine.due(SECOND, WINDOW, WAIT));
        engine.fill(1, score(1, 0.1), MODEL);
        assertTrue(engine.due(SECOND, WINDOW, WAIT));
        var second = engine.judge(SECOND, WAIT, false, 0);
        assertEquals(2, second.judged());
        assertEquals(0.9, second.results().get(1).collapseProbability());
        assertEquals(2, engine.lastSequence());
        assertEquals(1500, engine.summary().validMs());
    }

    @Test
    void theWindowDecidesWhenToJudge() {
        hold(0, 0);
        engine.fill(0, score(0, 0.1), MODEL);
        assertFalse(engine.due(WINDOW - 1, WINDOW, WAIT));
        assertTrue(engine.due(WINDOW, WINDOW, WAIT));
        engine.judge(WINDOW, WAIT, false, 0);
        // 비어 있던 묶음은 다음 구간을 받은 때부터 다시 센다.
        hold(1, WINDOW + 10);
        engine.fill(1, score(1, 0.1), MODEL);
        assertFalse(engine.due(2 * WINDOW + 9, WINDOW, WAIT));
        assertTrue(engine.due(2 * WINDOW + 10, WINDOW, WAIT));
    }

    @Test
    void restOrAwayIsJudgedWithoutWaitingForTheWindow() {
        hold(0, 0);
        engine.fill(0, score(0, 0.1), MODEL);
        assertFalse(engine.hold(phase(1, FrameInterval.Phase.rest), 0));
        engine.fill(1, List.of(), MODEL);
        assertTrue(engine.due(1, WINDOW, WAIT));
        assertEquals(2, engine.judge(1, WAIT, false, 0).judged());
        assertEquals(500, engine.summary().restMs());
        assertEquals("rest", engine.pausedReason());
    }

    @Test
    void aResultThatNeverComesBecomesMissingTime() {
        for (long sequence = 0; sequence < 3; sequence++) hold(sequence, 0);
        engine.fill(0, score(0, 0.1), MODEL);
        engine.fill(2, score(2, 0.1), MODEL);
        assertEquals(1, engine.judge(1, WAIT, false, 0).judged());
        // 순번 1의 결과가 결과 대기 시간을 넘겼다: 버리고 다음으로 간다.
        assertTrue(engine.due(WAIT, WINDOW, WAIT));
        var batch = engine.judge(WAIT, WAIT, false, 0);
        assertEquals(1, batch.dropped());
        assertEquals(1, batch.judged());
        assertEquals(1000, engine.summary().validMs());
        assertEquals(500, engine.summary().missingMs());
        // 늦게 온 결과는 넣지 않는다.
        assertFalse(engine.fill(1, score(1, 0.1), MODEL));
    }

    @Test
    void aFailedRequestIsDroppedAtOnce() {
        hold(0, 0);
        hold(1, 0);
        engine.fail(0);
        engine.fill(1, score(1, 0.1), MODEL);
        var batch = engine.judge(WINDOW, WAIT, false, 0);
        assertEquals(1, batch.dropped());
        assertEquals(1, batch.judged());
        assertEquals(500, engine.summary().validMs());
    }

    @Test
    void forceJudgesEverythingLeft() {
        hold(0, 0);
        hold(1, 0);
        engine.fill(0, score(0, 0.1), MODEL);
        var batch = engine.judge(1, WAIT, true, 0);
        assertEquals(1, batch.judged());
        assertEquals(1, batch.dropped());
        assertEquals(500, engine.summary().validMs());
        assertFalse(engine.due(Long.MAX_VALUE / 2, WINDOW, WAIT));
    }

    @Test
    void endWaitsForResultsStillOnTheWay() throws Exception {
        hold(0, 0);
        var late = CompletableFuture.runAsync(() -> {
            try {
                TimeUnit.MILLISECONDS.sleep(50);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            engine.fill(0, score(0, 0.1), MODEL);
        });
        assertTrue(engine.awaitSettled(System.nanoTime() + 5 * SECOND));
        late.get(5, TimeUnit.SECONDS);
        assertEquals(1, engine.judge(1, WAIT, true, 0).judged());
        // 오지 않는 결과는 기한까지만 기다린다.
        hold(1, 0);
        assertFalse(engine.awaitSettled(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(20)));
    }

    @Test
    void heldIntervalsAreCheckedForOrderTimeAndEnd() {
        hold(0, 0);
        assertEquals(0, engine.heldSequence());
        assertEquals(409, assertThrows(ApiError.class, () -> engine.hold(running(0), 0)).status());
        var overlapping = new FrameInterval("3.0", "keypoints-9-v1", 1, 400, 900, FrameInterval.Phase.running, List.of());
        assertEquals(409, assertThrows(ApiError.class, () -> engine.hold(overlapping, 0)).status());
        var limited = new SessionEngine(UUID.randomUUID(), POLICY, 500);
        limited.hold(running(0), 0);
        assertEquals(429, assertThrows(ApiError.class, () -> limited.hold(running(1), 0)).status());
        limited.fill(0, score(0, 0.1), MODEL);
        limited.judge(1, WAIT, true, 0);
        limited.end(500);
        assertEquals("SESSION_ENDED", assertThrows(ApiError.class, () -> limited.hold(running(2), 0)).code());
    }

    @Test
    void unmeasurableTimeoutEndsAtThatIntervalAndDropsTheRest() {
        for (long sequence = 0; sequence < 4; sequence++) {
            hold(sequence, 0);
            engine.fill(sequence, List.of(new FrameInference.Result(sequence * 500, false, 0,
                    Observation.DeviationType.none, "unmeasurable")), MODEL);
        }
        var batch = engine.judge(WINDOW, WAIT, false, 1000);
        assertTrue(batch.timedOut());
        assertEquals(2, batch.judged());
        assertTrue(engine.ended());
        assertEquals(1000, engine.summary().totalMs());
        assertFalse(engine.due(Long.MAX_VALUE / 2, WINDOW, WAIT));
    }
}
