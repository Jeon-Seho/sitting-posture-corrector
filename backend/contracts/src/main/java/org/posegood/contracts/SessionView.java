package org.posegood.contracts;

import java.util.List;
import java.util.UUID;

public record SessionView(
        String schemaVersion,
        UUID sessionId,
        Policy policy,
        String timerPolicy,
        boolean ended,
        long lastSequence,
        Summary summary,
        List<DecisionEvent> events) {}
