package org.posegood.api.workspace;

import tools.jackson.databind.JsonNode;

import org.posegood.api.common.ApiError;

import java.util.HashSet;
import java.util.Set;

/**
 * 설정 JSON 형식 검사(틀리면 400). {@code PUT /v2/workspace}가 쓴다.
 *
 * 형식: frontend/src/features/storage/types.ts. 저장 형식만 보며 자세나 시간을 판정하지 않는다.
 * 앱 기록 검사는 기록 저장(R2)과 함께 2026-10-28 삭제했다(계획 0061).
 */
final class RecordValidator {
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

    private static boolean bool(JsonNode value, String key) {
        var field = value.get(key);
        if (field == null || !field.isBoolean()) invalid();
        return field.asBoolean();
    }

    static ApiError invalid() {
        throw ApiError.badRequest("invalid storage contract");
    }
}
