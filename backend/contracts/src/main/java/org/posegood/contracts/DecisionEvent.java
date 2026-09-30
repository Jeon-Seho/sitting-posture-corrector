package org.posegood.contracts;
import java.util.UUID;
public record DecisionEvent(String schemaVersion, UUID sessionId, long eventId, String kind,
                            long timestampMs, long onsetMs, long onsetValidMs,
                            String deviationType, String reason) {}
