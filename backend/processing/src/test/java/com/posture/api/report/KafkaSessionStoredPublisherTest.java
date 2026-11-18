package com.posture.api.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** (D-67) posture.stored.v1 메시지가 계약 예시(contracts/realtime/examples/stored-session-stored.json)와 같은 필드·값인지. */
class KafkaSessionStoredPublisherTest {

	private static final Path EXAMPLE = Path.of("..", "..", "contracts", "realtime", "examples",
		"stored-session-stored.json");
	private static final JsonMapper MAPPER = JsonMapper.builder().build();

	private static Set<String> fields(JsonNode node) {
		Set<String> names = new HashSet<>();
		for (String name : node.propertyNames()) {
			names.add(name);
			if (node.get(name).isObject()) {
				for (String inner : node.get(name).propertyNames()) {
					names.add(name + "." + inner);
				}
			}
		}
		return names;
	}

	@Test
	void messageMatchesTheContractExample() throws Exception {
		JsonNode example = MAPPER.readTree(Files.readString(EXAMPLE));
		EpisodeDecision ended = new EpisodeDecision(example.get("session_id").asString(), 4, "session_ended",
			85000, 85000, "ended", 60000, "synthetic-user-1", Instant.parse("2026-10-18T06:01:25Z"), "none");
		Map<String, Object> message = KafkaSessionStoredPublisher.message(ended,
			Instant.parse("2026-10-18T06:01:25.300Z"));
		JsonNode actual = MAPPER.valueToTree(message);
		assertThat(fields(actual)).isEqualTo(fields(example));
		assertThat(actual.get("kind").asString()).isEqualTo("session_stored");
		assertThat(actual.get("session_id")).isEqualTo(example.get("session_id"));
		// 숫자 노드 종류(int·long)가 달라도 같은 값인지
		assertThat(actual.get("body").get("end_ms").asLong()).isEqualTo(example.get("body").get("end_ms").asLong());
		assertThat(actual.get("body").get("good_ms").asLong()).isEqualTo(example.get("body").get("good_ms").asLong());
		assertThat(actual.get("produced_at")).isEqualTo(example.get("produced_at"));
	}

	@Test
	void missingUserIdBecomesUnknown() {
		EpisodeDecision ended = new EpisodeDecision("00000000-0000-4000-8000-0000000000a1", 4, "session_ended",
			1000, 1000, "ended", 0);
		assertThat(KafkaSessionStoredPublisher.message(ended, Instant.EPOCH).get("user_id")).isEqualTo("unknown");
	}
}
