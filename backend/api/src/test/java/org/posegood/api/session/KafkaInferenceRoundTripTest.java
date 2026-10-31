package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.posegood.api.common.Json;
import org.posegood.api.common.JsonConfiguration;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.SessionRequests;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.convert.ApplicationConversionService;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.kafka.autoconfigure.KafkaAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.test.EmbeddedKafkaKraftBroker;
import org.springframework.kafka.test.utils.ContainerTestUtils;

import tools.jackson.databind.JsonNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Kafka 왕복(계획 0064, {@code posegood.inference.transport=kafka}): 같은 JVM 안의 브로커로 API의 발행·구독을 확인한다.
 *
 * 시험이 추론 서버 자리에 서서 요청 토픽을 읽고, Python 추론 서버의 실제 출력인 합성 결과 예시
 * (contracts/realtime/examples-inference-v3/result.json)를 결과 토픽에 넣는다. Docker는 쓰지 않는다.
 */
class KafkaInferenceRoundTripTest {
    private static final String REQUESTS = "posture.inference-request.v3";
    private static final String RESULTS = "posture.inference-result.v3";
    private static final Path EXAMPLES = Path.of("..", "..", "contracts", "realtime", "examples-inference-v3");

    private static EmbeddedKafkaKraftBroker broker;

    @BeforeAll
    static void start() {
        broker = new EmbeddedKafkaKraftBroker(1, 3, REQUESTS, RESULTS);
        broker.afterPropertiesSet();
    }

    @AfterAll
    static void stop() {
        broker.destroy();
    }

    private ApplicationContextRunner runner(SessionService sessions) {
        return new ApplicationContextRunner()
                // 앱처럼 "1h" 같은 시간 설정을 읽는다.
                .withInitializer(context -> context.getBeanFactory()
                        .setConversionService(ApplicationConversionService.getSharedInstance()))
                .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class, KafkaAutoConfiguration.class))
                .withUserConfiguration(JsonConfiguration.class, Json.class, KafkaInferenceGateway.class,
                        InferenceResultListener.class)
                .withBean(SessionService.class, () -> sessions)
                .withPropertyValues(
                        "posegood.inference.transport=kafka",
                        "posegood.model-version=reference-feature-rule-v1",
                        "posegood.kafka.request-topic=" + REQUESTS,
                        "posegood.kafka.result-topic=" + RESULTS,
                        "posegood.kafka.partitions=3",
                        "posegood.kafka.retention=1h",
                        "posegood.kafka.group-id=io-api-test",
                        "spring.kafka.bootstrap-servers=" + broker.getBrokersAsString(),
                        "spring.kafka.producer.key-serializer=" + StringSerializer.class.getName(),
                        "spring.kafka.producer.value-serializer=" + StringSerializer.class.getName(),
                        "spring.kafka.consumer.key-deserializer=" + StringDeserializer.class.getName(),
                        "spring.kafka.consumer.value-deserializer=" + StringDeserializer.class.getName(),
                        "spring.kafka.consumer.auto-offset-reset=latest",
                        "spring.jackson.property-naming-strategy=SNAKE_CASE",
                        "spring.jackson.deserialization.fail-on-unknown-properties=true");
    }

    private static KafkaConsumer<String, String> requestReader() {
        var consumer = new KafkaConsumer<String, String>(Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, broker.getBrokersAsString(),
                ConsumerConfig.GROUP_ID_CONFIG, "test-inference-" + UUID.randomUUID(),
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class));
        consumer.subscribe(List.of(REQUESTS));
        return consumer;
    }

    private static void publishResult(String key, String value) {
        try (var producer = new KafkaProducer<String, String>(Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, broker.getBrokersAsString(),
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class))) {
            producer.send(new ProducerRecord<>(RESULTS, key, value));
        }
    }

    private static FrameInference.Request request() {
        var point = new SessionRequests.Point(0.5, 0.4);
        var baseline = new SessionRequests.Landmarks(point, point, point, point, point, point, point, point, point);
        List<List<Double>> joints = java.util.Collections.nCopies(9, List.of(0.5, 0.4, 0.99));
        return FrameInference.Request.of(baseline, List.of(
                new FrameInference.Frame(21000, joints, null), new FrameInference.Frame(21100, null, null)));
    }

    @Test
    void requestsArePublishedKeyedBySessionAndResultsReachTheSession() throws Exception {
        var sessions = mock(SessionService.class);
        runner(sessions).run(context -> {
            var registry = context.getBean(KafkaListenerEndpointRegistry.class);
            for (var container : registry.getListenerContainers())
                ContainerTestUtils.waitForAssignment(container, 3);
            var json = context.getBean(Json.class);
            var gateway = context.getBean(InferenceGateway.class);
            var session = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");

            // API → 요청 토픽: 결과를 기다리지 않고(null) 키 session_id로 발행한다.
            try (var reader = requestReader()) {
                assertNull(gateway.submit(session, 42, request()));
                // 다른 시험이 같은 토픽에 넣은 요청은 건너뛰고 이 세션 것만 본다.
                var mine = new java.util.ArrayList<org.apache.kafka.clients.consumer.ConsumerRecord<String, String>>();
                long until = System.nanoTime() + Duration.ofSeconds(10).toNanos();
                while (mine.isEmpty() && System.nanoTime() < until)
                    for (var record : reader.poll(Duration.ofMillis(500)))
                        if (session.toString().equals(record.key())) mine.add(record);
                assertEquals(1, mine.size());
                var record = mine.get(0);
                JsonNode sent = json.mapper().readTree(record.value());
                assertEquals("1.0", sent.path("schema_version").asString());
                assertEquals(42, sent.path("sequence").asLong());
                assertEquals(session.toString(), sent.path("session_id").asString());
                assertEquals("3.0", sent.path("body").path("schema_version").asString());
                assertEquals(2, sent.path("body").path("frames").size());
                assertNotNull(sent.path("produced_at").asString());
            }

            // 추론 → 결과 토픽: 판정 엔진에 넣으러 SessionService#inferred로 간다.
            String result = Files.readString(EXAMPLES.resolve("result.json"));
            publishResult(session.toString(), result);
            verify(sessions, timeout(10_000)).inferred(eq(session), eq(42L), any(FrameInference.Response.class));

            // 형식이 틀린 결과는 버린다.
            publishResult(session.toString(), "{\"schema_version\":\"1.0\"}");
            verify(sessions, after(1_000).times(1)).inferred(any(), anyLong(), any());
        });
    }

    /**
     * 실제 Python 추론 서버(model/inference/kafka_worker.py)와 끝까지: API 발행 → 추론 → 결과 → API 구독.
     *
     * 저장소 Python 환경(.venv, kafka-python)이 필요해 기본 게이트에서는 돌리지 않는다:
     * {@code backend/gradlew -p backend :api:test -Pkafka-e2e --tests '*KafkaInferenceRoundTripTest'}.
     */
    @Test
    @EnabledIfSystemProperty(named = "posegood.kafka.e2e", matches = "true")
    void thePythonInferenceWorkerAnswersOverKafka() throws Exception {
        var root = Path.of("..", "..").toAbsolutePath().normalize();
        var python = root.resolve(".venv/Scripts/python.exe");
        if (!Files.exists(python)) python = root.resolve(".venv/bin/python");
        var process = new ProcessBuilder(python.toString(), "-c",
                "import time; from model.inference.kafka_worker import worker; worker.start(); time.sleep(120)")
                .directory(root.toFile())
                .redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD);
        process.environment().put("POSEGOOD_KAFKA_BOOTSTRAP_SERVERS", broker.getBrokersAsString());
        process.environment().put("POSEGOOD_KAFKA_GROUP_ID", "inference-e2e-" + UUID.randomUUID());
        var worker = process.start();
        try {
            var sessions = mock(SessionService.class);
            runner(sessions).run(context -> {
                for (var container : context.getBean(KafkaListenerEndpointRegistry.class).getListenerContainers())
                    ContainerTestUtils.waitForAssignment(container, 3);
                var gateway = context.getBean(InferenceGateway.class);
                var session = UUID.randomUUID();
                var response = org.mockito.ArgumentCaptor.forClass(FrameInference.Response.class);
                // 워커가 그룹에 들어오기 전 요청은 latest라 읽지 않으므로 답이 올 때까지 순번을 바꿔 다시 보낸다.
                long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
                for (long sequence = 0; ; sequence++) {
                    gateway.submit(session, sequence, request());
                    try {
                        verify(sessions, timeout(1_000).atLeastOnce()).inferred(eq(session), anyLong(), response.capture());
                        break;
                    } catch (AssertionError notYet) {
                        if (System.nanoTime() > deadline) throw notYet;
                    }
                }
                var answer = response.getValue();
                assertEquals("3.0", answer.schemaVersion());
                assertEquals("reference-feature-rule-v1", answer.modelVersion());
                assertEquals(List.of(21000L, 21100L), answer.frames().stream().map(FrameInference.Result::tMs).toList());
                // 사람이 없는 프레임은 판정 불가, API의 결과 확인도 통과한다.
                assertEquals("unmeasurable", answer.frames().get(1).invalidReason());
                InferenceClient.check(request().frames(), answer, "reference-feature-rule-v1");
            });
        } finally {
            worker.destroy();
        }
    }
}
