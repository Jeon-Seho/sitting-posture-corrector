package org.posegood.api.workspace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * DB 행으로 다시 만든 기록이 판정 엔진 결과와 같은지 확인하는 시험.
 *
 * 테이블에 없는 자세 방향과 입력 개수만 빼고 같아야 한다. 합성 입력만 쓴다.
 */
class RecordRebuildTest {
    private static final Policy POLICY = new Policy(3000, 2000, 5000, 0.7);

    private final UUID id = UUID.randomUUID();
    private final SessionEngine engine = new SessionEngine(id, POLICY);
    private long sequence;
    private long at;

    private void run(long until, double probability) {
        feed(until, probability, true, Observation.Phase.running);
    }

    private void feed(long until, double probability, boolean valid, Observation.Phase phase) {
        while (at < until) {
            long next = Math.min(until, at + 1000);
            engine.accept(
                    new Observation(
                            "2.0",
                            sequence++,
                            at,
                            next,
                            phase,
                            valid,
                            probability,
                            Observation.DeviationType.left_lean,
                            "synthetic-v1"));
            at = next;
        }
    }

    /** 판정 엔진의 사건·제외 구간에 대해 SessionRepository가 쓰는 행들로 다시 만든 조회 응답. */
    private SessionView rebuilt() {
        var view = engine.view();
        var episodes = new ArrayList<RecordRebuild.Episode>();
        long onset = 0, confirmed = 0;
        List<Long> alerts = null;
        for (var event : view.events()) {
            switch (event.kind()) {
                case "collapse_confirmed" -> {
                    onset = event.onsetMs();
                    confirmed = event.timestampMs();
                    alerts = new ArrayList<>(List.of(event.timestampMs()));
                }
                case "reminder" -> alerts.add(event.timestampMs());
                case "recovery_confirmed" ->
                        episodes.add(new RecordRebuild.Episode(onset, confirmed, event.timestampMs(), "RECOVERED", alerts));
                case "interrupted" ->
                        episodes.add(
                                new RecordRebuild.Episode(
                                        onset,
                                        confirmed,
                                        event.timestampMs(),
                                        "ended".equals(event.reason()) ? "SESSION_END" : "EXCLUDED",
                                        alerts));
                default -> {}
            }
        }
        var spans =
                engine.excluded().stream()
                        .map(span -> new RecordRebuild.Span(span.startMs(), span.endMs(), span.reason().name()))
                        .toList();
        long good = view.summary().normalMs() / 100 * 100; // good_sec은 DECIMAL(9,1)
        return RecordRebuild.view(id, POLICY, view.summary().totalMs(), good, episodes, spans);
    }

    /** 테이블로 표현할 수 있는 만큼만 남긴 엔진의 조회 응답. */
    private SessionView expected() {
        var view = engine.view();
        var events =
                view.events().stream()
                        .map(
                                event ->
                                        new SessionView.DecisionEvent(
                                                event.schemaVersion(),
                                                event.sessionId(),
                                                event.eventId(),
                                                event.kind(),
                                                event.timestampMs(),
                                                event.onsetMs(),
                                                event.onsetValidMs(),
                                                "session_ended".equals(event.kind()) ? "none" : "unspecified",
                                                event.reason()))
                        .toList();
        return new SessionView(
                view.schemaVersion(),
                view.sessionId(),
                view.policy(),
                view.timerPolicy(),
                view.ended(),
                -1,
                view.summary(),
                events);
    }

    @Test
    void everyInterruptionReasonAndStatisticSurvivesTheTables() {
        run(4000, 0.1);
        run(9000, 0.9); // 3초 지속 뒤 7000ms에 붕괴
        run(15000, 0.9); // 12000ms에 재알림
        run(18000, 0.1); // 17000ms에 회복
        run(22000, 0.9); // 21000ms에 붕괴
        feed(24000, 0.0, true, Observation.Phase.rest); // 중단: 휴식
        run(28000, 0.9); // 27000ms에 붕괴
        feed(29000, 0.0, true, Observation.Phase.away); // 중단: 자리 비움
        run(33000, 0.9); // 32000ms에 붕괴
        feed(34000, 0.9, false, Observation.Phase.running); // 중단: 판정 불가
        run(38000, 0.9); // 37000ms에 붕괴
        at = 40000; // 2초 공백: 중단(누락)
        run(44000, 0.9); // 43000ms에 붕괴
        sequence++; // 순번 누락: 중단(missing_sequence)
        run(48000, 0.9); // 47000ms에 붕괴
        engine.end(50000); // 종료 전 공백 후 세션 종료

        var view = engine.view();
        assertTrue(view.summary().collapseCount() >= 7);
        assertTrue(view.summary().restMs() > 0 && view.summary().awayMs() > 0);
        assertTrue(view.summary().unknownMs() > 0 && view.summary().missingMs() > 0);
        var reasons = view.events().stream().map(SessionView.DecisionEvent::reason).toList();
        for (var reason : List.of("rest", "away", "unmeasurable", "missing", "missing_sequence"))
            assertTrue(reasons.contains(reason), reason);
        assertEquals(expected(), rebuilt());
    }

    @Test
    void goodTimeKeepsTenthsOfASecondAndRatesFollowIt() {
        feed(500, 0.1, true, Observation.Phase.running);
        engine.accept(
                new Observation(
                        "2.0", sequence++, 500, 1250, Observation.Phase.running, true, 0.1,
                        Observation.DeviationType.none, "synthetic-v1"));
        engine.end(1250);
        var summary = rebuilt().summary();
        assertEquals(1250, summary.validMs());
        assertEquals(1200, summary.normalMs());
        assertEquals(50, summary.deviationMs());
        assertEquals(1200.0 / 1250, summary.keepRate());
    }

    @Test
    void lostSessionHasNoViewAndZeroTotals() {
        var rules = org.posegood.api.policy.ThresholdPolicyRepository.Values.of(POLICY);
        var record =
                RecordRebuild.record(
                        id.toString(),
                        "2026-10-10T00:00:00Z",
                        "2026-10-10T00:01:00Z",
                        rules,
                        UUID.randomUUID(),
                        "ERROR",
                        null,
                        "reference-feature-rule-v1",
                        null);
        assertFalse(record.get("server").get("confirmed").asBoolean());
        assertTrue(record.get("server").get("view").isNull());
        assertEquals("unmeasured", record.get("server").get("modelVersion").asText());
        assertEquals(0, record.get("total").asDouble());
        assertEquals(0, record.get("events").size());
        assertEquals(5, record.get("rules").get("realertSeconds").asInt());
        assertEquals(0.7, record.get("rules").get("threshold").asDouble());
    }
}
