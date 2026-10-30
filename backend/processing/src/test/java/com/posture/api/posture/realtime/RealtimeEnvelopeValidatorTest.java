package com.posture.api.posture.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** (D-21) 계약 v1 features 메시지 검사 — 팀 계약 예제와 같은 형태로 확인. */
class RealtimeEnvelopeValidatorTest {

	static Map<String, Object> envelope(String kind, Map<String, Object> body) {
		Map<String, Object> envelope = new LinkedHashMap<>();
		envelope.put("schema_version", "1.0");
		envelope.put("message_id", "00000000-0000-4000-8000-000000000002");
		envelope.put("session_id", "00000000-0000-4000-8000-0000000000a1");
		envelope.put("user_id", "synthetic-user-1");
		envelope.put("produced_at", "2026-10-06T06:00:01.000Z");
		envelope.put("kind", kind);
		envelope.put("body", body);
		return envelope;
	}

	static Map<String, Object> featuresBody() {
		Map<String, Object> features = new HashMap<>();
		features.put("head_gap_delta", 0.0);
		features.put("lateral_offset_delta", 0.2);
		features.put("shoulder_tilt_delta", 0.0);
		features.put("current_quality", 0.9);
		features.put("baseline_quality", 0.8);
		Map<String, Object> body = new HashMap<>();
		body.put("schema_version", "2.0");
		body.put("feature_version", "shoulder-relative-deltas-v1");
		body.put("baseline_id", "00000000-0000-4000-8000-000000000001");
		body.put("sequence", 0);
		body.put("start_ms", 0);
		body.put("end_ms", 1000);
		body.put("phase", "running");
		body.put("measurement_quality", "good");
		body.put("features", features);
		return body;
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
		Map<String, Object> body = new HashMap<>();
		body.put("policy", policy);
		body.put("baseline_id", "00000000-0000-4000-8000-000000000001");
		body.put("frame", frame);
		return body;
	}

	@Test
	void contractExamplesPass() {
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", featuresBody()))).isEmpty();
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("session_started", startedBody())))
			.isEmpty();
		Map<String, Object> ended = new HashMap<>();
		ended.put("end_ms", 3000);
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("session_ended", ended))).isEmpty();
	}

	@Test
	void poorSegmentWithNullFeaturesPasses() {
		Map<String, Object> body = featuresBody();
		body.put("measurement_quality", "poor");
		body.put("features", null);
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", body))).isEmpty();
	}

	@Test
	void unknownFieldsAreRejected() {
		Map<String, Object> envelope = envelope("features", featuresBody());
		envelope.put("landmarks", List.of(1, 2, 3));
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope)).anyMatch(e -> e.contains("landmarks"));

		Map<String, Object> body = featuresBody();
		((Map<String, Object>)body.get("features")).put("nose_x", 0.5);
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", body)))
			.anyMatch(e -> e.contains("nose_x"));
	}

	@Test
	void segmentLengthAndFieldsAreChecked() {
		Map<String, Object> body = featuresBody();
		body.put("end_ms", 2000); // 2000ms > 1500
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", body)))
			.anyMatch(e -> e.contains("구간 길이"));

		Map<String, Object> envelope = envelope("observation", featuresBody()); // features 토픽에 없는 kind
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope)).isNotEmpty();

		Map<String, Object> bad = envelope("features", featuresBody());
		bad.put("session_id", "not-a-uuid");
		bad.put("schema_version", "2.0");
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(bad)).hasSize(2);
	}

	@Test
	void nonFiniteFeatureIsRejected() {
		Map<String, Object> body = featuresBody();
		((Map<String, Object>)body.get("features")).put("head_gap_delta", Double.NaN);
		assertThat(RealtimeEnvelopeValidator.validateFeaturesMessage(envelope("features", body)))
			.anyMatch(e -> e.contains("head_gap_delta"));
	}
}
