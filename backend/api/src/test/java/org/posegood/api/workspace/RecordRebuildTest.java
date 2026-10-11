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
 * A view rebuilt from the rows the API writes equals the engine's view, except what the tables do
 * not keep: the deviation type and the accepted input count. Synthetic inputs only.
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

    /** The rows SessionRepository writes for the engine's decisions and exclusions. */
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
        long good = view.summary().normalMs() / 100 * 100; // good_sec is DECIMAL(9,1)
        return RecordRebuild.view(id, POLICY, view.summary().totalMs(), good, episodes, spans);
    }

    /** The engine's view as the tables can express it. */
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
        run(9000, 0.9); // collapse at 7000 after a 3 s hold
        run(15000, 0.9); // reminder at 12000
        run(18000, 0.1); // recovery at 17000
        run(22000, 0.9); // collapse at 21000
        feed(24000, 0.0, true, Observation.Phase.rest); // interrupted: rest
        run(28000, 0.9); // collapse at 27000
        feed(29000, 0.0, true, Observation.Phase.away); // interrupted: away
        run(33000, 0.9); // collapse at 32000
        feed(34000, 0.9, false, Observation.Phase.running); // interrupted: unmeasurable
        run(38000, 0.9); // collapse at 37000
        at = 40000; // two-second gap: interrupted: missing
        run(44000, 0.9); // collapse at 43000
        sequence++; // sequence hole: interrupted: missing_sequence
        run(48000, 0.9); // collapse at 47000
        engine.end(50000); // gap before the end, then the session end

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
