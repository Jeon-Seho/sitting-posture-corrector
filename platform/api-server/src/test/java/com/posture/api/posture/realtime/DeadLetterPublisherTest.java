package com.posture.api.posture.realtime;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-36) DLQ 메시지 형식. */
class DeadLetterPublisherTest {

    @Test
    void messageCarriesSourcePositionReasonAndPayload() {
        Map<String, Object> m = DeadLetterPublisher.message("api-server-cep-v1", "posture.inference.v1", 2, 41L,
                "sid", "모르는 kind: x", "{\"kind\":\"x\"}", Instant.parse("2026-10-09T05:00:00Z"));
        assertThat(m.get("schema_version")).isEqualTo("1.0");
        assertThat(m.get("source_topic")).isEqualTo("posture.inference.v1");
        assertThat(m.get("source_partition")).isEqualTo(2);
        assertThat(m.get("source_offset")).isEqualTo(41L);
        assertThat(m.get("key")).isEqualTo("sid");
        assertThat(m.get("reason")).isEqualTo("모르는 kind: x");
        assertThat(m.get("payload")).isEqualTo("{\"kind\":\"x\"}");
        assertThat(m.get("payload_truncated")).isEqualTo(false);
    }

    @Test
    void hugePayloadIsTruncated() {
        String big = "x".repeat(DeadLetterPublisher.MAX_PAYLOAD_CHARS + 10);
        Map<String, Object> m = DeadLetterPublisher.message("c", "t", 0, 0, null, "r", big, Instant.EPOCH);
        assertThat(((String) m.get("payload")).length()).isEqualTo(DeadLetterPublisher.MAX_PAYLOAD_CHARS);
        assertThat(m.get("payload_truncated")).isEqualTo(true);
    }
}
