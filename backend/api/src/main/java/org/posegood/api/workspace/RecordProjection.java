package org.posegood.api.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.api.contract.SessionView;

/**
 * The app's display projection of server decisions into RecordItem events. It mirrors what the app
 * stores; it never re-derives time decisions.
 */
final class RecordProjection {
    private RecordProjection() {}

    static ArrayNode events(SessionView view, boolean confirmed) {
        var factory = JsonNodeFactory.instance;
        ArrayNode events = factory.arrayNode();
        ObjectNode active = null;
        long block = 0;
        for (var decision : view.events()) {
            double at = decision.timestampMs() / 1000.0;
            switch (decision.kind()) {
                case "collapse_confirmed" -> {
                    active = factory.objectNode();
                    active.put("id", decision.eventId());
                    active.put(
                            "type",
                            switch (decision.deviationType()) {
                                case "forward_slouch" -> "forwardHead";
                                case "left_lean", "right_lean" -> "tilt";
                                default -> "referenceChange";
                            });
                    active.put("startAt", decision.onsetMs() / 1000.0);
                    active.put("validStartAt", decision.onsetValidMs() / 1000.0);
                    active.put("confirmedAt", at);
                    active.putNull("endAt");
                    active.put("durationSec", 0);
                    active.put("alerts", 1);
                    active.put("firstAlertAt", at);
                    active.put("recovered", false);
                    active.putNull("recoverySec");
                    active.put("endedBySession", false);
                    active.putNull("endReason");
                    active.put("blockId", block);
                    events.add(active);
                }
                case "reminder" -> {
                    if (active != null) active.put("alerts", active.get("alerts").asLong() + 1);
                }
                case "recovery_confirmed", "interrupted" -> {
                    if (active == null) break;
                    boolean recovered = decision.kind().equals("recovery_confirmed");
                    active.put("endAt", at);
                    active.put("durationSec", at - active.get("startAt").asDouble());
                    active.put("recovered", recovered);
                    if (recovered) active.put("recoverySec", at - active.get("firstAlertAt").asDouble());
                    else active.putNull("recoverySec");
                    active.put("endedBySession", "ended".equals(decision.reason()));
                    if (recovered) active.putNull("endReason");
                    else
                        active.put(
                                "endReason",
                                "ended".equals(decision.reason())
                                        ? "ended"
                                        : "rest".equals(decision.reason()) ? "paused" : "unknown");
                    active = null;
                    if (!recovered) block++;
                }
                default -> {
                    // session_ended has no RecordItem event.
                }
            }
        }
        if (!confirmed && active != null) {
            double at = view.summary().totalMs() / 1000.0;
            active.put("endAt", at);
            active.put("durationSec", at - active.get("startAt").asDouble());
            active.put("recovered", false);
            active.putNull("recoverySec");
            active.put("endedBySession", false);
            active.put("endReason", "unknown");
        }
        return events;
    }

    /** JSON equality where numbers compare by value (3 equals 3.0). */
    static boolean same(JsonNode left, JsonNode right) {
        if (left.isNumber() && right.isNumber()) return left.asDouble() == right.asDouble();
        if (left.getNodeType() != right.getNodeType() || left.size() != right.size()) return false;
        if (left.isObject()) {
            for (var entry : left.properties())
                if (!right.has(entry.getKey()) || !same(entry.getValue(), right.get(entry.getKey())))
                    return false;
            return true;
        }
        if (left.isArray()) {
            for (int i = 0; i < left.size(); i++) if (!same(left.get(i), right.get(i))) return false;
            return true;
        }
        return left.equals(right);
    }
}
