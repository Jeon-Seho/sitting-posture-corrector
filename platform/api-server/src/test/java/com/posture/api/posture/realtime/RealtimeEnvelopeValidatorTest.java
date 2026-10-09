package com.posture.api.posture.realtime;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-21) 계약 v1 features 메시지 검사 — 팀 계약 예제와 같은 형태로 확인. */
class RealtimeEnvelopeValidatorTest {

    static Map<String, Object> envelope(String kind, Map<String, Object> body) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("schema_version", "1.0");
        m.put("message_id", "00000000-0000-4000-8000-000000000002");
        m.put("session_id", "00000000-0000-4000-8000-0000000000a1");
        m.put("user_id", "synthetic-user-1");
        m.put("produced_at", "2026-10-06T06:00:01.000Z");
        m.put("kind", kind);
        m.put("body", body);
        return m;
    }

    static Map<String, Object> featuresBody() {
        Map<String, Object> f = new HashMap<>();
        f.put("head_gap_delta", 0.0);
        f.put("lateral_offset_delta", 0.2);
        f.put("shoulder_tilt_delta", 0.0);
        f.put("current_quality", 0.9);
        f.put("baseline_quality", 0.8);
        Map<String, Object> b = new HashMap<>();
        b.put("schema_version", "2.0");
        b.put("feature_version", "shoulder-relative-deltas-v1");
        b.put("baseline_id", "00000000-0000-4000-8000-000000000001");
        b.put("sequence", 0);
        b.put("start_ms", 0);
        b.put("end_ms", 1000);
        b.put("phase", "running");
        b.put("measurement_quality", "good");
        b.put("features", f);
        return b;
    }

    static Map<String, Object> startedBody() {
        Map<String, Object> policy = new HashMap<>();
        policy.put("hold_ms", 3000);
        policy.put("recovery_ms", 2000);
        policy.put("reminder_ms", 60000);
        policy.put("threshold", 0.7);
        Map<String, Object> frame = new HashMap<>();
        frame.put("width", 640);
        frame.put("height", 480);
        Map<String, Object> b = new HashMap<>();
        b.put("policy", policy);
        b.put("baseline_id", "00000000-0000-4000-8000-000000000001");
        b.put("frame", frame);
        return b;
    }

    @Test
    void contractExamplesPass() {
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", featuresBody()))).isEmpty();
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("session_started", startedBody()))).isEmpty();
        Map<String, Object> ended = new HashMap<>();
        ended.put("end_ms", 3000);
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("session_ended", ended))).isEmpty();
    }

    @Test
    void poorSegmentWithNullFeaturesPasses() {
        Map<String, Object> b = featuresBody();
        b.put("measurement_quality", "poor");
        b.put("features", null);
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", b))).isEmpty();
    }

    @Test
    void unknownFieldsAreRejected() {
        Map<String, Object> m = envelope("features", featuresBody());
        m.put("landmarks", List.of(1, 2, 3));
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(m)).anyMatch(e -> e.contains("landmarks"));

        Map<String, Object> b = featuresBody();
        ((Map<String, Object>) b.get("features")).put("nose_x", 0.5);
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", b)))
                .anyMatch(e -> e.contains("nose_x"));
    }

    @Test
    void segmentLengthAndFieldsAreChecked() {
        Map<String, Object> b = featuresBody();
        b.put("end_ms", 2000);   // 2000ms > 1500
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", b)))
                .anyMatch(e -> e.contains("구간 길이"));

        Map<String, Object> m = envelope("observation", featuresBody());   // features 토픽에 없는 kind
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(m)).isNotEmpty();

        Map<String, Object> bad = envelope("features", featuresBody());
        bad.put("session_id", "not-a-uuid");
        bad.put("schema_version", "2.0");
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(bad)).hasSize(2);
    }

    @Test
    void nonFiniteFeatureIsRejected() {
        Map<String, Object> b = featuresBody();
        ((Map<String, Object>) b.get("features")).put("head_gap_delta", Double.NaN);
        assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", b)))
                .anyMatch(e -> e.contains("head_gap_delta"));
    }
}
