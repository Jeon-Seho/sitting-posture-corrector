package com.posture.api.posture.realtime;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * (D-21) 실시간 계약 v1 {@code posture.features.v1} 메시지(공통 봉투 + 본문) 검사.
 *
 * <p>계약 원칙("모르는 필드는 거부")에 따라 봉투·본문의 모르는 필드를 거부한다. JSON 스키마 전체를
 * 다시 구현하지는 않고, Kafka 뒤의 소비자가 멈추지 않는 데 필요한 필드·형식·범위만 본다
 * (구간 길이 {@code 0 < end_ms - start_ms <= 1500}, 유한수 등).
 */
public final class RealtimeEnvelopeValidator {

    static final Set<String> ENVELOPE_FIELDS =
            Set.of("schema_version", "message_id", "session_id", "user_id", "produced_at", "kind", "body");
    static final Set<String> FEATURE_KINDS = Set.of("session_started", "features", "session_ended");

    private static final Set<String> FEATURES_BODY_FIELDS = Set.of("schema_version", "feature_version",
            "baseline_id", "sequence", "start_ms", "end_ms", "phase", "measurement_quality", "features");
    private static final Set<String> DELTA_FIELDS = Set.of("head_gap_delta", "lateral_offset_delta",
            "shoulder_tilt_delta", "current_quality", "baseline_quality");
    private static final Set<String> STARTED_BODY_FIELDS = Set.of("policy", "baseline_id", "frame");
    private static final Set<String> POLICY_FIELDS = Set.of("hold_ms", "recovery_ms", "reminder_ms", "threshold");
    private static final Pattern UUID = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final long MAX_MS = 86_400_000L;
    private static final long MAX_SEGMENT_MS = 1_500L;

    private RealtimeEnvelopeValidator() {
    }

    /** 오류 목록을 돌려준다. 비어 있으면 통과. */
    public static List<String> validateFeaturesMessage(Map<String, Object> msg) {
        List<String> errors = new ArrayList<>();
        if (msg == null) {
            errors.add("메시지가 비어 있음");
            return errors;
        }
        unknownFields(msg, ENVELOPE_FIELDS, "", errors);
        if (!"1.0".equals(msg.get("schema_version"))) {
            errors.add("schema_version은 \"1.0\"이어야 함");
        }
        uuid(msg.get("message_id"), "message_id", errors);
        uuid(msg.get("session_id"), "session_id", errors);
        Object userId = msg.get("user_id");
        if (!(userId instanceof String u) || u.isEmpty() || u.length() > 64) {
            errors.add("user_id는 1~64자 문자열이어야 함");
        }
        if (!(msg.get("produced_at") instanceof String p) || !isInstant(p)) {
            errors.add("produced_at은 UTC 시각(ISO-8601)이어야 함");
        }
        Object kind = msg.get("kind");
        if (!(kind instanceof String k) || !FEATURE_KINDS.contains(k)) {
            errors.add("kind는 session_started / features / session_ended 중 하나여야 함");
            return errors;
        }
        if (!(msg.get("body") instanceof Map<?, ?> rawBody)) {
            errors.add("body는 객체여야 함");
            return errors;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) rawBody;
        switch (k) {
            case "features" -> validateFeaturesBody(body, errors);
            case "session_started" -> validateStartedBody(body, errors);
            default -> {
                unknownFields(body, Set.of("end_ms"), "body.", errors);
                range(body.get("end_ms"), 0, MAX_MS, "body.end_ms", errors);
            }
        }
        return errors;
    }

    private static void validateFeaturesBody(Map<String, Object> body, List<String> errors) {
        unknownFields(body, FEATURES_BODY_FIELDS, "body.", errors);
        if (!"2.0".equals(body.get("schema_version"))) {
            errors.add("body.schema_version은 \"2.0\"이어야 함");
        }
        if (!"shoulder-relative-deltas-v1".equals(body.get("feature_version"))) {
            errors.add("body.feature_version은 \"shoulder-relative-deltas-v1\"이어야 함");
        }
        uuid(body.get("baseline_id"), "body.baseline_id", errors);
        range(body.get("sequence"), 0, Long.MAX_VALUE, "body.sequence", errors);
        Long start = range(body.get("start_ms"), 0, MAX_MS, "body.start_ms", errors);
        Long end = range(body.get("end_ms"), 1, MAX_MS, "body.end_ms", errors);
        if (start != null && end != null && (end - start <= 0 || end - start > MAX_SEGMENT_MS)) {
            errors.add("구간 길이(end_ms - start_ms)는 0 초과 1500 이하여야 함");
        }
        if (!Set.of("running", "rest", "away").contains(body.get("phase"))) {
            errors.add("body.phase는 running / rest / away 중 하나여야 함");
        }
        if (!Set.of("good", "poor").contains(body.get("measurement_quality"))) {
            errors.add("body.measurement_quality는 good / poor 중 하나여야 함");
        }
        if (!body.containsKey("features")) {
            errors.add("body.features가 없음(판정 불가면 null)");
        } else if (body.get("features") != null) {
            if (!(body.get("features") instanceof Map<?, ?> f)) {
                errors.add("body.features는 객체 또는 null이어야 함");
                return;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> features = (Map<String, Object>) f;
            unknownFields(features, DELTA_FIELDS, "body.features.", errors);
            for (String name : DELTA_FIELDS) {
                Object v = features.get(name);
                if (!(v instanceof Number n) || !Double.isFinite(n.doubleValue())) {
                    errors.add("body.features." + name + "는 유한한 숫자여야 함");
                } else if (name.endsWith("_quality") && (n.doubleValue() < 0 || n.doubleValue() > 1)) {
                    errors.add("body.features." + name + "는 0~1이어야 함");
                }
            }
        }
    }

    private static void validateStartedBody(Map<String, Object> body, List<String> errors) {
        unknownFields(body, STARTED_BODY_FIELDS, "body.", errors);
        uuid(body.get("baseline_id"), "body.baseline_id", errors);
        if (!(body.get("policy") instanceof Map<?, ?> p)) {
            errors.add("body.policy는 객체여야 함");
        } else {
            @SuppressWarnings("unchecked")
            Map<String, Object> policy = (Map<String, Object>) p;
            unknownFields(policy, POLICY_FIELDS, "body.policy.", errors);
            range(policy.get("hold_ms"), 1, MAX_MS, "body.policy.hold_ms", errors);
            range(policy.get("recovery_ms"), 1, MAX_MS, "body.policy.recovery_ms", errors);
            range(policy.get("reminder_ms"), 1, MAX_MS, "body.policy.reminder_ms", errors);
            Object th = policy.get("threshold");
            if (!(th instanceof Number n) || !(n.doubleValue() > 0 && n.doubleValue() <= 1)) {
                errors.add("body.policy.threshold는 0 초과 1 이하여야 함");
            }
        }
        if (!(body.get("frame") instanceof Map<?, ?> f)) {
            errors.add("body.frame은 객체여야 함");
        } else {
            @SuppressWarnings("unchecked")
            Map<String, Object> frame = (Map<String, Object>) f;
            unknownFields(frame, Set.of("width", "height"), "body.frame.", errors);
            range(frame.get("width"), 1, 16384, "body.frame.width", errors);
            range(frame.get("height"), 1, 16384, "body.frame.height", errors);
        }
    }

    private static void unknownFields(Map<String, Object> m, Set<String> allowed, String prefix, List<String> errors) {
        for (String key : m.keySet()) {
            if (!allowed.contains(key)) {
                errors.add("모르는 필드: " + prefix + key);
            }
        }
    }

    private static void uuid(Object v, String name, List<String> errors) {
        if (!(v instanceof String s) || !UUID.matcher(s).matches()) {
            errors.add(name + "는 UUID 문자열이어야 함");
        }
    }

    /** 정수이고 범위 안이면 값을, 아니면 오류를 남기고 null. */
    private static Long range(Object v, long min, long max, String name, List<String> errors) {
        if (v instanceof Integer || v instanceof Long || v instanceof Short) {
            long x = ((Number) v).longValue();
            if (x >= min && x <= max) {
                return x;
            }
        }
        errors.add(name + "는 " + min + "~" + max + " 정수여야 함");
        return null;
    }

    static boolean isInstant(String s) {
        try {
            Instant.parse(s);
            return true;
        } catch (DateTimeParseException exc) {
            return false;
        }
    }
}
