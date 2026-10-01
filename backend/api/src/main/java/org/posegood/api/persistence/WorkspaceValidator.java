package org.posegood.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;

import org.posegood.contracts.ContractError;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/** Validates storage contracts, not posture classification or temporal decisions. */
public final class WorkspaceValidator {
    private WorkspaceValidator() {}

    public static void rules(JsonNode value) {
        shape(
                value,
                Set.of("holdSeconds", "recoverSeconds", "realertSeconds", "threshold"),
                Set.of());
        number(value, "holdSeconds", 0, 10, true);
        number(value, "recoverSeconds", 0, 10, true);
        number(value, "realertSeconds", 0, 180, true);
        number(value, "threshold", 0, 1, true);
    }

    public static void preferences(JsonNode value) {
        shape(value, Set.of("show_demo", "alerts_on"), Set.of());
        bool(value, "show_demo");
        bool(value, "alerts_on");
    }

    public static void record(JsonNode value) {
        shape(
                value,
                Set.of("id", "startedAt", "endedAt", "mode", "valid", "good", "total", "events"),
                Set.of("rules", "server"));
        text(value, "id", 128);
        var start = date(value, "startedAt");
        var end = date(value, "endedAt");
        if (end.isBefore(start)) invalid();
        if (!Set.of("camera", "demo").contains(value.path("mode").asText())) invalid();
        double total = number(value, "total", 0, 86400, false),
                valid = number(value, "valid", 0, total, false),
                good = number(value, "good", 0, valid, false);
        if (good > valid || !value.path("events").isArray() || value.path("events").size() > 30000)
            invalid();
        if (value.has("rules")) rules(value.get("rules"));
        Set<Long> ids = new HashSet<>();
        for (var event : value.get("events")) {
            shape(
                    event,
                    Set.of(
                            "id",
                            "type",
                            "startAt",
                            "confirmedAt",
                            "endAt",
                            "durationSec",
                            "alerts",
                            "blockId",
                            "recovered",
                            "endedBySession",
                            "endReason",
                            "firstAlertAt",
                            "recoverySec"),
                    Set.of("validStartAt"));
            long id = integer(event, "id", 1, Long.MAX_VALUE);
            if (!ids.add(id)) invalid();
            if (!Set.of("forwardHead", "tilt", "referenceChange")
                    .contains(event.path("type").asText())) invalid();
            double onset = number(event, "startAt", 0, total, false),
                    confirmed = number(event, "confirmedAt", onset, total, false),
                    finish = number(event, "endAt", confirmed, total, false);
            double duration = number(event, "durationSec", 0, total, false);
            if (!near(duration, finish - onset)) invalid();
            long alerts = integer(event, "alerts", 0, 10000);
            integer(event, "blockId", 0, Long.MAX_VALUE);
            boolean recovered = bool(event, "recovered"), ended = bool(event, "endedBySession");
            var reason = event.get("endReason");
            if (!(reason.isNull()
                    || Set.of("paused", "unknown", "ended").contains(reason.asText()))) invalid();
            if (recovered) {
                if (!reason.isNull() || ended) invalid();
            } else if (reason.isNull() || ended != reason.asText().equals("ended")) invalid();
            var first = event.get("firstAlertAt");
            if (first.isNull()) {
                if (alerts != 0) invalid();
            } else {
                number(event, "firstAlertAt", confirmed, total, false);
                if (alerts == 0) invalid();
            }
            var recovery = event.get("recoverySec");
            if (!recovered) {
                if (!recovery.isNull()) invalid();
            } else if (!first.isNull()) {
                if (recovery.isNull()
                        || !near(
                                number(event, "recoverySec", 0, total, false),
                                finish - first.asDouble())) invalid();
            } else if (!recovery.isNull()) invalid();
            if (event.has("validStartAt"))
                number(event, "validStartAt", 0, Math.min(onset, valid), false);
        }
        if (value.has("server")) {
            var server = value.get("server");
            shape(server, Set.of("baselineId", "modelVersion", "confirmed", "view"), Set.of());
            if (!value.path("mode").asText().equals("camera") || !value.has("rules")) invalid();
            text(server, "baselineId", 36);
            if (!server.get("baselineId")
                    .asText()
                    .matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) invalid();
            text(server, "modelVersion", 64);
            if (!server.get("modelVersion").asText().matches("[a-z0-9._-]{1,64}")) invalid();
            bool(server, "confirmed");
        }
    }

    public static void shape(JsonNode value, Set<String> required, Set<String> optional) {
        if (value == null || !value.isObject()) invalid();
        var allowed = new HashSet<>(required);
        allowed.addAll(optional);
        value.fieldNames()
                .forEachRemaining(
                        key -> {
                            if (!allowed.contains(key)) invalid();
                        });
        for (String key : required) if (!value.has(key)) invalid();
    }

    public static double number(
            JsonNode value, String key, double min, double max, boolean exclusive) {
        var field = value.get(key);
        if (field == null || !field.isNumber()) invalid();
        double number = field.asDouble();
        if (!Double.isFinite(number)
                || number < min
                || (exclusive && number == min)
                || number > max) invalid();
        return number;
    }

    private static long integer(JsonNode value, String key, long min, long max) {
        var field = value.get(key);
        if (field == null || !field.isIntegralNumber() || !field.canConvertToLong()) invalid();
        long number = field.asLong();
        if (number < min || number > max) invalid();
        return number;
    }

    private static boolean bool(JsonNode value, String key) {
        var field = value.get(key);
        if (field == null || !field.isBoolean()) invalid();
        return field.asBoolean();
    }

    private static void text(JsonNode value, String key, int max) {
        var field = value.get(key);
        if (field == null
                || !field.isTextual()
                || field.asText().isBlank()
                || field.asText().length() > max) invalid();
    }

    private static Instant date(JsonNode value, String key) {
        text(value, key, 64);
        try {
            return Instant.parse(value.get(key).asText());
        } catch (Exception invalid) {
            invalid();
            return null;
        }
    }

    private static boolean near(double a, double b) {
        return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
    }

    public static void invalid() {
        throw new ContractError(400, "invalid storage contract");
    }
}
