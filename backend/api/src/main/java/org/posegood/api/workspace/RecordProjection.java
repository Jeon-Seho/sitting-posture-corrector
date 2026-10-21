package org.posegood.api.workspace;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import org.posegood.api.contract.SessionView;

/**
 * 판정 사건 목록을 앱 기록(RecordItem)의 사건 형식으로 바꾼다(프론트와 같은 규칙).
 *
 * 시간 판정을 다시 하지 않고 서버 사건을 옮기기만 한다.
 */
final class RecordProjection {
    private RecordProjection() {}

    /** 판정 사건 → 앱 기록 사건. */
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
                    // session_ended는 앱 기록 사건이 없다.
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

    /**
     * 숫자 3과 3.0을 같게 보는 JSON 비교.
     */
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
