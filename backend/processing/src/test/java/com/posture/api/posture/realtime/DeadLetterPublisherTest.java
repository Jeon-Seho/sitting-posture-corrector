package com.posture.api.posture.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** (D-36) DLQ 메시지 형식. */
class DeadLetterPublisherTest {

	@Test
	void messageCarriesSourcePositionReasonAndPayload() {
		Map<String, Object> envelope = DeadLetterPublisher.message("judge-v1", "posture.inference.v1", 2, 41L,
			"sid", "모르는 kind: x", "{\"kind\":\"x\"}", Instant.parse("2026-10-09T05:00:00Z"));
		assertThat(envelope.get("schema_version")).isEqualTo("1.0");
		assertThat(envelope.get("source_topic")).isEqualTo("posture.inference.v1");
		assertThat(envelope.get("source_partition")).isEqualTo(2);
		assertThat(envelope.get("source_offset")).isEqualTo(41L);
		assertThat(envelope.get("key")).isEqualTo("sid");
		assertThat(envelope.get("reason")).isEqualTo("모르는 kind: x");
		assertThat(envelope.get("payload")).isEqualTo("{\"kind\":\"x\"}");
		assertThat(envelope.get("payload_truncated")).isEqualTo(false);
	}

	@Test
	void hugePayloadIsTruncated() {
		String big = "x".repeat(DeadLetterPublisher.MAX_PAYLOAD_CHARS + 10);
		Map<String, Object> envelope = DeadLetterPublisher.message("c", "t", 0, 0, null, "r", big, Instant.EPOCH);
		assertThat(((String)envelope.get("payload")).length()).isEqualTo(DeadLetterPublisher.MAX_PAYLOAD_CHARS);
		assertThat(envelope.get("payload_truncated")).isEqualTo(true);
	}
}
