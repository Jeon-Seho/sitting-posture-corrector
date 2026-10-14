package org.posegood.api.workspace;

import tools.jackson.databind.JsonNode;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * 앱 기록·설정 JSON 형식 검사(틀리면 400).
 *
 * 형식: frontend/src/features/storage/types.ts. 저장 형식만 보며 자세나 시간을 판정하지 않는다.
 */
final class RecordValidator {
    private static final String UUID_TEXT = "[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";

    private RecordValidator() {}

    /** 판정 기준 범위 검사. */
    static void rules(JsonNode value) {
        shape(value, Set.of("holdSeconds", "recoverSeconds", "realertSeconds", "threshold"), Set.of());
        number(value, "holdSeconds", 0, 10, true);
        number(value, "recoverSeconds", 0, 10, true);
        number(value, "realertSeconds", 0, 180, true);
        number(value, "threshold", 0, 1, true);
    }

    /** 설정(자세 알림) 검사. */
    static void preferences(JsonNode value) {
        // The 「자세 알림」 switch (`alert_enabled`); the demo toggle stays on the device.
        shape(value, Set.of("alerts_on"), Set.of());
        bool(value, "alerts_on");
    }

    /** 기록 한 건의 형식 검사. */
    static void record(JsonNode value) {
        shape(
                value,
                Set.of("id", "startedAt", "endedAt", "mode", "valid", "good", "total", "events"),
                Set.of("rules", "server"));
        text(value, "id", 128);
        if (!Json.text(value.get("id")).matches("[\\x21-\\x7e]+")) invalid();
        var start = date(value, "startedAt");
        var end = date(value, "endedAt");
        if (end.isBefore(start)) invalid();
        if (!Set.of("camera", "demo").contains(Json.text(value.path("mode")))) invalid();
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
            if (!Set.of("forwardHead", "tilt", "referenceChange").contains(Json.text(event.path("type"))))
                invalid();
            double onset = number(event, "startAt", 0, total, false),
                    confirmed = number(event, "confirmedAt", onset, total, false),
                    finish = number(event, "endAt", confirmed, total, false);
            double duration = number(event, "durationSec", 0, total, false);
            if (!near(duration, finish - onset)) invalid();
            long alerts = integer(event, "alerts", 0, 10000);
            integer(event, "blockId", 0, Long.MAX_VALUE);
            boolean recovered = bool(event, "recovered"), ended = bool(event, "endedBySession");
            var reason = event.get("endReason");
            if (!(reason.isNull() || Set.of("paused", "unknown", "ended").contains(Json.text(reason))))
                invalid();
            if (recovered) {
                if (!reason.isNull() || ended) invalid();
            } else if (reason.isNull() || ended != Json.text(reason).equals("ended")) invalid();
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
            if (!Json.text(value.path("mode")).equals("camera") || !value.has("rules")) invalid();
            text(server, "baselineId", 36);
            if (!Json.text(server.get("baselineId")).matches(UUID_TEXT)) invalid();
            text(server, "modelVersion", 64);
            if (!Json.text(server.get("modelVersion")).matches("[a-z0-9._-]{1,64}")) invalid();
            bool(server, "confirmed");
            if (!Json.text(value.get("id")).matches(UUID_TEXT)) invalid();
        }
    }

    static void shape(JsonNode value, Set<String> required, Set<String> optional) {
        if (value == null || !value.isObject()) invalid();
        var allowed = new HashSet<>(required);
        allowed.addAll(optional);
        for (String key : value.propertyNames()) if (!allowed.contains(key)) invalid();
        for (String key : required) if (!value.has(key)) invalid();
    }

    static double number(JsonNode value, String key, double min, double max, boolean exclusive) {
        var field = value.get(key);
        if (field == null || !field.isNumber()) invalid();
        double number = field.asDouble();
        if (!Double.isFinite(number) || number < min || (exclusive && number == min) || number > max)
            invalid();
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
        if (field == null || !field.isString() || field.stringValue().isBlank() || field.stringValue().length() > max)
            invalid();
    }

    private static Instant date(JsonNode value, String key) {
        text(value, key, 64);
        try {
            return Instant.parse(value.get(key).stringValue());
        } catch (RuntimeException unparsable) {
            throw invalid();
        }
    }

    static boolean near(double a, double b) {
        return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
    }

    static ApiError invalid() {
        throw ApiError.badRequest("invalid storage contract");
    }
}
