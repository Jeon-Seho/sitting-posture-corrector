package org.posegood.api.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.apache.kafka.clients.consumer.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.common.Json;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * kafka 경로 결과 → 앱 메시지 시험(D-57): 결과 토픽 예시(contracts/realtime/examples)를 넣으면 앱 메시지가 WebSocket v2
 * 예시(contracts/realtime/examples-v2)와 같은 필드로 나오고, 멈춘 이유·판정 불가 사유·측정불가 한도·종료가 local과 같은 규칙인지.
 */
class KafkaResultsTest {
	private static final Path KAFKA = Path.of("..", "..", "contracts", "realtime", "examples");
	private static final Path APP = Path.of("..", "..", "contracts", "realtime", "examples-v2");
	private static final JsonMapper MAPPER = JsonMapper.builder()
		.propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
		.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
		.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
		.enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
		.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
		.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
		.build();
	private static final Json JSON = new Json(MAPPER);
	private static final UUID SESSION = UUID.fromString("00000000-0000-4000-8000-0000000000a1");

	private final List<PipelineResult> published = new ArrayList<>();
	private KafkaResults results;

	@BeforeEach
	@SuppressWarnings("unchecked")
	void setup() {
		results = new KafkaResults(mock(Consumer.class), "posture.episodes.v1", "posture.alerts.v1", JSON,
			event -> published.add((PipelineResult)event),
			(session, sequence) -> sequence == 7 ? "head_turn" : null, Duration.ofSeconds(2));
	}

	private static ObjectNode kafka(String name) throws Exception {
		return (ObjectNode)MAPPER.readTree(Files.readString(KAFKA.resolve(name)));
	}

	private void episodes(ObjectNode message) {
		results.handle("posture.episodes.v1", MAPPER.writeValueAsString(message));
	}

	/** 판정기 관측 하나(예시를 바꿈). */
	private void observation(long sequence, long startMs, long endMs, String phase, boolean valid) throws Exception {
		var message = kafka("episodes-observation.json");
		var body = (ObjectNode)message.get("body");
		body.put("sequence", sequence).put("start_ms", startMs).put("end_ms", endMs).put("phase", phase)
			.put("valid", valid);
		if (!valid) {
			body.putNull("posture").putNull("collapse_probability").put("hold_ms", 0).put("recovery_ms", 0);
		}
		episodes(message);
	}

	private JsonNode app(int index) {
		return MAPPER.readTree(JSON.write(published.get(index).messages().get(0)));
	}

	private static Set<String> fields(JsonNode node) {
		var names = new HashSet<String>();
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

	private static void sameFields(String example, JsonNode actual) throws Exception {
		assertEquals(fields(MAPPER.readTree(Files.readString(APP.resolve(example)))), fields(actual), example);
	}

	@Test
	void observationBecomesObservation4WithTheJudgeValuesAndSequence() throws Exception {
		episodes(kafka("episodes-observation.json"));
		var result = published.get(0);
		assertEquals(SESSION, result.sessionId());
		assertEquals(1L, result.observedSequence());
		var message = app(0);
		sameFields("ws-observation.json", message);
		var observation = message.get("observation");
		assertEquals("4.0", observation.get("schema_version").asString());
		assertEquals("bad", observation.get("posture").asString());
		assertEquals(1000, observation.get("hold_ms").asLong());
		assertTrue(observation.get("invalid_reason").isNull());
	}

	@Test
	void invalidObservationTakesTheHeadTurnHintOnlyWhileRunning() throws Exception {
		observation(7, 3500, 4000, "running", false);
		observation(8, 4000, 4500, "running", false);
		observation(9, 4500, 5000, "rest", false);
		sameFields("ws-observation-unmeasurable.json", app(0));
		assertEquals("head_turn", app(0).get("observation").get("invalid_reason").asString());
		assertEquals("unmeasurable", app(1).get("observation").get("invalid_reason").asString());
		assertEquals("unmeasurable", app(2).get("observation").get("invalid_reason").asString());
		assertTrue(app(2).get("observation").get("posture").isNull());
	}

	@Test
	void progressCarriesThePausedReasonOfTheLastObservation() throws Exception {
		var progress = kafka("episodes-progress.json");
		episodes(progress);
		observation(2, 1000, 1500, "rest", false);
		episodes(progress);
		observation(3, 1500, 2000, "running", false);
		episodes(progress);
		observation(4, 2000, 2500, "running", true);
		episodes(progress);
		sameFields("ws-progress.json", app(0));
		assertTrue(app(0).get("paused_reason").isNull());
		assertEquals(1, app(0).get("last_sequence").asLong());
		assertEquals("rest", app(2).get("paused_reason").asString());
		assertEquals("unmeasurable", app(4).get("paused_reason").asString());
		assertTrue(app(6).get("paused_reason").isNull());
	}

	@Test
	void decisionPassesThroughAndSessionEndedEndsTheConnection() throws Exception {
		episodes(kafka("episodes-decision.json"));
		sameFields("ws-decision.json", app(0));
		assertEquals("collapse_confirmed", app(0).get("event").get("kind").asString());
		assertNull(published.get(0).endedTotalMs());

		var ended = kafka("episodes-decision.json");
		((ObjectNode)ended.get("body").get("event")).put("kind", "session_ended").put("reason", "ended");
		((ObjectNode)ended.get("body").get("summary")).put("total_ms", 85000);
		episodes(ended);
		assertEquals(85000L, published.get(1).endedTotalMs());
	}

	@Test
	void alertIsSentAsItIs() throws Exception {
		results.handle("posture.alerts.v1", MAPPER.writeValueAsString(kafka("alerts-alert.json")));
		var message = app(0);
		sameFields("ws-alert.json", message);
		assertEquals(1, message.get("event_id").asLong());
		assertEquals("forward_slouch", message.get("deviation_type").asString());
	}

	@Test
	void unmeasurableForTheTimeoutEndsOnceAtThatInterval() throws Exception {
		observation(0, 0, 1000, "running", false);
		observation(1, 1000, 1500, "rest", false); // 쉬기는 0으로
		observation(2, 1500, 2500, "away", false);
		observation(3, 2500, 3500, "running", false); // 2초째 → 한도
		observation(4, 3500, 4000, "running", false);
		assertNull(published.get(2).unmeasurableEndMs());
		assertEquals(3500L, published.get(3).unmeasurableEndMs());
		assertNull(published.get(4).unmeasurableEndMs()); // 한 번만
	}

	@Test
	void brokenMessagesAreSkipped() {
		results.handle("posture.episodes.v1", "{not json");
		results.handle("posture.episodes.v1", "{\"session_id\":\"x\",\"kind\":\"observation\",\"body\":{}}");
		assertTrue(published.isEmpty());
	}
}
