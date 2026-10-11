package org.posegood.api.contract;

import java.util.List;
import java.util.UUID;

/** Session view v1 (contracts/session-view.v1.schema.json). */
public record SessionView(
        String schemaVersion,
        UUID sessionId,
        Policy policy,
        String timerPolicy,
        boolean ended,
        long lastSequence,
        Summary summary,
        List<DecisionEvent> events) {

    public static final String TIMER_POLICY = "legacy-interrupt-v1";

    /** Posture event v1 (contracts/posture-event.v1.schema.json). */
    public record DecisionEvent(
            String schemaVersion,
            UUID sessionId,
            long eventId,
            String kind,
            long timestampMs,
            long onsetMs,
            long onsetValidMs,
            String deviationType,
            String reason) {}

    /** Field order follows the schema; null rates mean "not computable". */
    public record Summary(
            long totalMs,
            long validMs,
            long normalMs,
            long deviationMs,
            long restMs,
            long awayMs,
            long unknownMs,
            long missingMs,
            long collapseCount,
            long alertCount,
            long intervalCount,
            Double keepRate,
            Double eventsPerHour,
            Double meanIntervalMs,
            Double meanRecoveryMs) {}
}
