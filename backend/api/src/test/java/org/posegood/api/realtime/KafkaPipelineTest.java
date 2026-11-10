package org.posegood.api.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Policy;
import org.posegood.api.session.FrameFeatures;
import org.posegood.api.session.LiveSession;
import org.posegood.api.session.SessionRepository;
import org.posegood.api.session.SessionService;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * kafka 경로 발행 시험(D-57): {@code session_started} 한 번 → 구간마다 {@code features} → {@code session_ended} 한 번,
 * 키는 {@code session_id}, 봉투·본문 필드는 계약 예시(contracts/realtime/examples/features-*.json)와 같다.
 * 브로커는 {@link Producer} 대역으로 대신한다(실제 왕복은 서버 통합 테스트).
 */
class KafkaPipelineTest {
	private static final Path APP = Path.of("..", "..", "contracts", "realtime", "examples-v2");
	private static final Path KAFKA = Path.of("..", "..", "contracts", "realtime", "examples");
	private static final JsonMapper MAPPER = JsonMapper.builder()
		.propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
		.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
		.enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
		.enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
		.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
		.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
		.build();
	private static final Json JSON = new Json(MAPPER);
	private static final long OWNER = 7;
	private static final UUID SESSION = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
	private static final UUID BASELINE_ID = UUID.fromString("00000000-0000-4000-8000-000000000001");
	private static final Instant STARTED = Instant.parse("2026-11-10T01:00:00Z");
	private static final Policy POLICY = new Policy(3000, 3000, 60000, 0.7);
	private static final FrameFeatures.Features BASELINE = new FrameFeatures.Features(0.9, 0, 0, 1, 0);

	private SessionService sessions;
	private Producer<String, String> producer;
	private final List<ProducerRecord<String, String>> sent = new ArrayList<>();
	private KafkaPipeline pipeline;

	@BeforeEach
	@SuppressWarnings("unchecked")
	void setup() {
		sessions = mock(SessionService.class);
		var session = mock(LiveSession.class);
		var row = new SessionRepository.Stored(1, SESSION, OWNER, POLICY, BASELINE_ID, true, STARTED, null,
			BigDecimal.ZERO, 0, 0);
		when(session.row()).thenReturn(row);
		when(session.locked(any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(0)).get());
		when(sessions.require(OWNER, SESSION)).thenReturn(session);
		when(sessions.openRealtime(OWNER, SESSION)).thenReturn(new SessionService.Realtime(BASELINE, true, STARTED));
		producer = mock(Producer.class);
		when(producer.send(any())).thenAnswer(call -> {
			sent.add(call.getArgument(0));
			return CompletableFuture.completedFuture((RecordMetadata)null);
		});
		pipeline = new KafkaPipeline(sessions, producer, "posture.features.v1", JSON, Duration.ofSeconds(3),
			Duration.ofHours(24), Clock.fixed(Instant.parse("2026-11-10T01:00:01Z"), ZoneOffset.UTC));
	}

	private static FrameInterval interval(long sequence, long startMs, long endMs) throws Exception {
		var item = (ObjectNode)MAPPER.readTree(Files.readString(APP.resolve("ws-features.json"))).get("items").get(0);
		item.put("sequence", sequence).put("start_ms", startMs).put("end_ms", endMs);
		return JSON.convert(item, FrameInterval.class);
	}

	private JsonNode message(int index) {
		return MAPPER.readTree(sent.get(index).value());
	}

	private static Set<String> names(JsonNode node) {
		var names = new HashSet<String>();
		for (String name : node.propertyNames()) {
			names.add(name);
		}
		return names;
	}

	/** 보낸 메시지가 같은 kind의 계약 예시와 봉투·본문 필드 이름이 같다. */
	private static void sameShape(String example, JsonNode actual) throws Exception {
		var expected = MAPPER.readTree(Files.readString(KAFKA.resolve(example)));
		assertEquals(names(expected), names(actual));
		assertEquals(names(expected.get("body")), names(actual.get("body")));
		assertEquals(expected.get("kind").asString(), actual.get("kind").asString());
	}

	@Test
	void publishesStartedOnceThenFeaturesThenEndedKeyedBySession() throws Exception {
		assertEquals(STARTED, pipeline.open(OWNER, SESSION).startedAt());
		pipeline.open(OWNER, SESSION); // 같은 세션으로 다시 열어도 시작은 한 번
		var accepted = pipeline.frames(OWNER, SESSION, interval(0, 0, 100), BASELINE);
		assertEquals(0, accepted.lastSequence());
		assertNull(accepted.progress()); // progress는 결과 토픽에서 온다
		pipeline.frames(OWNER, SESSION, interval(1, 100, 200), BASELINE);
		pipeline.finish(OWNER, SESSION, 600L);
		pipeline.finish(OWNER, SESSION, null); // 종료도 한 번

		assertEquals(4, sent.size());
		sent.forEach(record -> {
			assertEquals("posture.features.v1", record.topic());
			assertEquals(SESSION.toString(), record.key());
		});
		sameShape("features-session-started.json", message(0));
		sameShape("features-features.json", message(1));
		sameShape("features-session-ended.json", message(3));
		assertEquals("7", message(0).get("user_id").asString());
		assertEquals("2026-11-10T01:00:01Z", message(0).get("produced_at").asString());
		assertEquals(3000, message(0).get("body").get("policy").get("hold_ms").asLong());
		assertEquals(BASELINE_ID.toString(), message(1).get("body").get("baseline_id").asString());
		assertEquals(1, message(2).get("body").get("sequence").asLong());
		assertEquals(600, message(3).get("body").get("end_ms").asLong());
	}

	@Test
	void disconnectEndsAtLastIntervalAndEndedSessionRefusesInput() throws Exception {
		pipeline.open(OWNER, SESSION);
		pipeline.frames(OWNER, SESSION, interval(0, 0, 100), BASELINE);
		pipeline.finish(OWNER, SESSION, null);
		assertEquals(100, message(2).get("body").get("end_ms").asLong());
		var ended = assertThrows(ApiError.class, () -> pipeline.frames(OWNER, SESSION, interval(1, 100, 200),
			BASELINE));
		assertEquals("SESSION_ENDED", ended.code());
		assertEquals("SESSION_ENDED", assertThrows(ApiError.class, () -> pipeline.open(OWNER, SESSION)).code());
	}

	@Test
	void outOfOrderOverlapAndTimeLimitAreRefusedWithoutPublishing() throws Exception {
		pipeline.open(OWNER, SESSION);
		pipeline.frames(OWNER, SESSION, interval(5, 500, 600), BASELINE);
		assertEquals(409, assertThrows(ApiError.class,
			() -> pipeline.frames(OWNER, SESSION, interval(5, 600, 700), BASELINE)).status());
		assertEquals(409, assertThrows(ApiError.class,
			() -> pipeline.frames(OWNER, SESSION, interval(6, 550, 700), BASELINE)).status());
		var limited = new KafkaPipeline(sessions, producer, "posture.features.v1", JSON, Duration.ofSeconds(3),
			Duration.ofMillis(1000), Clock.systemUTC());
		limited.open(OWNER, SESSION);
		assertEquals(429, assertThrows(ApiError.class,
			() -> limited.frames(OWNER, SESSION, interval(0, 900, 1100), BASELINE)).status());
		assertEquals(3, sent.size()); // 시작 2(파이프라인마다) + 구간 1
	}

	@Test
	void brokerFailureIs503AndDoesNotAdvance() throws Exception {
		pipeline.open(OWNER, SESSION);
		when(producer.send(any())).thenReturn(CompletableFuture.failedFuture(new IllegalStateException("down")));
		var failed = assertThrows(ApiError.class, () -> pipeline.frames(OWNER, SESSION, interval(0, 0, 100),
			BASELINE));
		assertEquals(503, failed.status());
		// 받지 않은 구간은 다음 순번으로 넘어가지 않는다 — 같은 순번은 다시 받을 수 있다(앱은 다시 보내지 않음).
		when(producer.send(any())).thenAnswer(call -> {
			sent.add(call.getArgument(0));
			return CompletableFuture.completedFuture((RecordMetadata)null);
		});
		assertEquals(0, pipeline.frames(OWNER, SESSION, interval(0, 0, 100), BASELINE).lastSequence());
	}
}
