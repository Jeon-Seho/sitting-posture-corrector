package org.posegood.api.session;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.Summary;
import org.posegood.api.engine.SessionEngine;

import java.util.List;
import java.util.UUID;

/**
 * Synchronous application events published while the session lock is held, so listeners (the
 * realtime channel) see one session's changes in order.
 */
public final class SessionUpdates {
    private SessionUpdates() {}

    /** One accepted input; {@code observation} is null when only an end produced decisions. */
    public record Progressed(
            UUID sessionId,
            Observation observation,
            List<SessionEngine.Decided> decided,
            long lastSequence,
            Summary summary,
            boolean ended) {}

    /** The session left memory; {@code reason} is a realtime closed reason. */
    public record Removed(UUID sessionId, String reason) {}
}
