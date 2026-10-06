package org.posegood.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.contracts.SessionView;

/** Mirrors only display projection of accepted CEP decisions, never temporal classification. */
final class ServerRecordProjection {
    private ServerRecordProjection() {}

    static ArrayNode events(SessionView view, boolean confirmed) {
        var factory = JsonNodeFactory.instance;
        ArrayNode events = factory.arrayNode();
        ObjectNode active = null;
        long block = 0;
        for (var decision : view.events()) {
            double at = decision.timestampMs() / 1000.0;
            if (decision.kind().equals("collapse_confirmed")) {
                active = factory.objectNode();
                active.put("id", decision.eventId());
                String type =
                        switch (decision.deviationType()) {
                            case "forward_slouch" -> "forwardHead";
                            case "left_lean", "right_lean" -> "tilt";
                            default -> "referenceChange";
                        };
                active.put("type", type);
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
            } else if (decision.kind().equals("reminder") && active != null)
                active.put("alerts", active.get("alerts").asLong() + 1);
            else if ((decision.kind().equals("recovery_confirmed")
                            || decision.kind().equals("interrupted"))
                    && active != null) {
                boolean recovered = decision.kind().equals("recovery_confirmed");
                active.put("endAt", at);
                active.put("durationSec", at - active.get("startAt").asDouble());
                active.put("recovered", recovered);
                if (recovered)
                    active.put("recoverySec", at - active.get("firstAlertAt").asDouble());
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
                if (decision.kind().equals("interrupted")) block++;
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

    static boolean same(JsonNode left, JsonNode right) {
        if (left.isNumber() && right.isNumber()) return left.asDouble() == right.asDouble();
        if (left.getNodeType() != right.getNodeType() || left.size() != right.size()) return false;
        if (left.isObject()) {
            var fields = left.fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                if (!right.has(entry.getKey())
                        || !same(entry.getValue(), right.get(entry.getKey()))) return false;
            }
            return true;
        }
        if (left.isArray()) {
            for (int i = 0; i < left.size(); i++)
                if (!same(left.get(i), right.get(i))) return false;
            return true;
        }
        return left.equals(right);
    }
}
