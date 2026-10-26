package org.posegood.api.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import jakarta.validation.Validation;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.session.FrameFeatures;
import org.posegood.api.session.SessionService;
import org.posegood.api.session.SessionUpdates;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * {@code /v2/realtime} 순서·제한 시험: hello 순서와 제한 시간, ready, features, end, 끊김 종료, bad_message.
 *
 * 앱 메시지는 contracts/realtime/examples-v2의 예시를 그대로 보내고, 서버 메시지는 같은 종류의 예시와 필드가
 * 같은지 확인한다. 판정·저장은 {@link SessionService} 대역으로 대신한다(실제 흐름은 MySQL 통합 시험).
 */
class RealtimeHandlerV2Test {
    private static final Path EXAMPLES = Path.of("..", "..", "contracts", "realtime", "examples-v2");
    /** application.properties의 spring.jackson 설정과 같은 읽기 규칙. */
    private static final JsonMapper MAPPER =
            JsonMapper.builder()
                    .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                    .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
                    .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                    .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                    .build();
    private static final long OWNER = 7;
    private static final UUID SESSION = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
    /** 서버의 세션 시작 시각. ready.started_at, closed.ended_at(= 시작 + SUMMARY.total_ms)의 기준(ADR 0028). */
    private static final Instant STARTED = Instant.parse("2026-10-26T01:00:00.120Z");
    private static final SessionView.Summary SUMMARY =
            new SessionView.Summary(21500, 20500, 17000, 3500, 0, 0, 1000, 0, 1, 1, 0, 0.8293, 175.6, null, null);
    private static final FrameFeatures.Features BASELINE = new FrameFeatures.Features(0.9, 0, 0, 1, 0);

    private SessionService sessions;
    private RealtimeHandlerV2 handler;
    private final List<Fake> sockets = new ArrayList<>();

    @BeforeEach
    void setup() {
        sessions = mock(SessionService.class);
        handler = handler(Duration.ofSeconds(10));
    }

    @AfterEach
    void cleanup() {
        handler.shutdown();
    }

    private RealtimeHandlerV2 handler(Duration hello) {
        var current = mock(CurrentUser.class);
        when(current.id(any(Authentication.class))).thenReturn(OWNER);
        return new RealtimeHandlerV2(sessions, current, new Json(MAPPER),
                Validation.buildDefaultValidatorFactory().getValidator(), hello, Duration.ofSeconds(5));
    }

    private static ObjectNode example(String name) throws Exception {
        return (ObjectNode) MAPPER.readTree(Files.readString(EXAMPLES.resolve(name)));
    }

    private Fake connect(RealtimeHandlerV2 target) throws Exception {
        var fake = new Fake("s" + sockets.size(), target);
        sockets.add(fake);
        target.afterConnectionEstablished(fake.socket);
        return fake;
    }

    private void send(Fake fake, JsonNode message) throws Exception {
        handler.handleTextMessage(fake.socket, new TextMessage(MAPPER.writeValueAsString(message)));
    }

    private Fake measuring() throws Exception {
        when(sessions.openRealtime(OWNER, SESSION)).thenReturn(new SessionService.Realtime(BASELINE, true, STARTED));
        var fake = connect(handler);
        send(fake, example("ws-hello-measure.json"));
        same(example("ws-ready-measure.json"), fake.only("ready"));
        return fake;
    }

    @Test
    void measurementRunsHelloReadyFeaturesEnd() throws Exception {
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE)))
                .thenReturn(new SessionService.Status(42, SUMMARY, null));
        send(fake, example("ws-features.json"));
        assertEquals(42, fake.only("ack").get("last_sequence").asLong());
        same(example("ws-progress.json"), fake.only("progress"));

        // end → 세션 이벤트로 decision(session_ended) → closed(ended).
        doAnswer(call -> {
                    handler.progressed(ended());
                    return null;
                })
                .when(sessions)
                .finish(OWNER, SESSION, 600000L);
        send(fake, example("ws-end.json"));
        var kinds = fake.types();
        assertEquals(List.of("ready", "ack", "progress", "decision", "closed"), kinds);
        assertEquals("session_ended", fake.only("decision").get("event").get("kind").asString());
        same(example("ws-closed.json"), fake.only("closed"));
        assertTrue(fake.closed.get());
        // 끝난 세션이라 연결이 닫혀도 끊김 종료를 다시 부르지 않는다.
        verify(sessions).finish(OWNER, SESSION, 600000L);
        verify(sessions, never()).finish(eq(OWNER), eq(SESSION), isNull());
    }

    @Test
    void observationDecisionAndAlertFollowTheSessionEvents() throws Exception {
        var fake = measuring();
        var event = new SessionView.DecisionEvent("1.0", SESSION, 1, "collapse_confirmed", 21000, 18000, 17000,
                "forward_slouch", null);
        var observation = new Observation("2.0", 42, 21000, 21500, Observation.Phase.running, true, 0.82,
                Observation.DeviationType.forward_slouch, "reference-feature-rule-v1");
        handler.progressed(new SessionUpdates.Progressed(SESSION, observation,
                List.of(new SessionEngine.Decided(event, SUMMARY)), 42, SUMMARY, false,
                Observation.V3.of(observation, null), null));
        same(example("ws-observation.json"), fake.only("observation"));
        same(example("ws-decision.json"), fake.only("decision"));
        same(example("ws-alert.json"), fake.only("alert"));

        var invalid = new Observation("2.0", 43, 21500, 22000, Observation.Phase.running, false, 0,
                Observation.DeviationType.none, "reference-feature-rule-v1");
        handler.progressed(new SessionUpdates.Progressed(SESSION, invalid, List.of(), 43, SUMMARY, false,
                Observation.V3.of(invalid, SessionEngine.invalidReason(invalid, null)), "unmeasurable"));
        same(example("ws-observation-unmeasurable.json"), fake.all("observation").get(1));
        assertFalse(fake.closed.get());
    }

    @Test
    void alertsAreNotSentWhenTheSessionTurnedThemOff() throws Exception {
        when(sessions.openRealtime(OWNER, SESSION)).thenReturn(new SessionService.Realtime(BASELINE, false, STARTED));
        var fake = connect(handler);
        send(fake, example("ws-hello-measure.json"));
        var event = new SessionView.DecisionEvent("1.0", SESSION, 1, "collapse_confirmed", 21000, 18000, 17000,
                "forward_slouch", null);
        handler.progressed(new SessionUpdates.Progressed(SESSION, null,
                List.of(new SessionEngine.Decided(event, SUMMARY)), 42, SUMMARY, false, null, null));
        assertEquals(List.of("ready", "decision"), fake.types());
    }

    @Test
    void helloMustArriveFirstAndInTime() throws Exception {
        var slow = handler(Duration.ofMillis(50));
        try {
            var fake = connect(slow);
            long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
            while (!fake.closed.get() && System.nanoTime() < deadline) Thread.onSpinWait();
            assertEquals(List.of("closed"), fake.types());
            assertEquals("bad_message", fake.only("closed").get("reason").asString());
        } finally {
            slow.shutdown();
        }

        var early = connect(handler);
        send(early, example("ws-features.json"));
        assertEquals("bad_message", early.only("closed").get("reason").asString());

        var wrongVersion = connect(handler);
        send(wrongVersion, example("ws-hello-measure.json").put("schema_version", "1.0"));
        assertEquals("bad_message", wrongVersion.only("closed").get("reason").asString());
    }

    @Test
    void malformedOrOversizedFeaturesCloseWithBadMessage() throws Exception {
        var two = measuring();
        var message = example("ws-features.json");
        message.withArray("items").add(message.withArray("items").get(0).deepCopy());
        send(two, message);
        assertEquals("bad_message", two.only("closed").get("reason").asString());
        // 세션이 이 연결에서 끝나기 전에 닫혔으니 서버 종료 시각은 아직 없다(앱은 나중에 기록 조회로 받는다).
        assertTrue(two.only("closed").get("ended_at").isNull());
        verify(sessions).finish(OWNER, SESSION, null); // 측정 중 끊김 → 마지막 구간 끝에서 종료

        var wrongPhase = measuring();
        send(wrongPhase, example("ws-features-calibration.json"));
        assertEquals("bad_message", wrongPhase.only("closed").get("reason").asString());

        var large = measuring();
        var padded = example("ws-end.json").put("pad", "x".repeat(RealtimeHandlerV2.MAX_BYTES));
        send(large, padded);
        assertEquals("bad_message", large.only("closed").get("reason").asString());

        var again = measuring();
        send(again, example("ws-hello-measure.json"));
        assertEquals("bad_message", again.only("closed").get("reason").asString());
        verify(sessions, never()).frames(anyLong(), any(), any(), any());
    }

    @Test
    void refusalsMapToClosedReasons() throws Exception {
        doThrow(new ApiError(409, "BASELINE_REQUIRED", "register a baseline first"))
                .when(sessions)
                .openRealtime(OWNER, SESSION);
        var noBaseline = connect(handler);
        send(noBaseline, example("ws-hello-measure.json"));
        assertEquals("no_baseline", noBaseline.only("closed").get("reason").asString());

        doThrow(ApiError.ended()).when(sessions).openRealtime(OWNER, SESSION);
        var ended = connect(handler);
        send(ended, example("ws-hello-measure.json"));
        assertEquals("session_lost", ended.only("closed").get("reason").asString());

        doThrow(ApiError.notFound()).when(sessions).openRealtime(OWNER, SESSION);
        var other = connect(handler);
        send(other, example("ws-hello-measure.json"));
        assertEquals("not_owner", other.only("closed").get("reason").asString());

        var anonymous = new Fake("anonymous", handler);
        when(anonymous.socket.getPrincipal()).thenReturn(null);
        handler.afterConnectionEstablished(anonymous.socket);
        send(anonymous, example("ws-hello-calibration.json"));
        assertEquals("unauthorized", anonymous.only("closed").get("reason").asString());
        // 받아들여지지 않은 연결이 끊겨도 세션을 끝내지 않는다.
        verify(sessions, never()).finish(anyLong(), any(), any());
    }

    @Test
    void inferenceFailureSendsStalledAndKeepsTheConnection() throws Exception {
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE)))
                .thenThrow(ApiError.upstream("inference unavailable"));
        send(fake, example("ws-features.json"));
        assertEquals(-1, fake.only("stalled").get("since_last_sequence").asLong());
        assertFalse(fake.closed.get());
    }

    @Test
    void timeLimitEndsTheSessionWithLimitReached() throws Exception {
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE)))
                .thenThrow(ApiError.limit("session time limit reached"));
        doAnswer(call -> {
                    handler.progressed(ended());
                    return null;
                })
                .when(sessions)
                .finish(eq(OWNER), eq(SESSION), isNull());
        send(fake, example("ws-features.json"));
        assertEquals(List.of("ready", "decision", "closed"), fake.types());
        assertEquals("limit_reached", fake.only("closed").get("reason").asString());
    }

    @Test
    void calibrationCollectsFramesAndAnswersOnEnd() throws Exception {
        var fake = connect(handler);
        send(fake, example("ws-hello-calibration.json"));
        same(example("ws-ready-calibration.json"), fake.only("ready"));
        send(fake, example("ws-features-calibration.json"));
        assertEquals(3, fake.only("ack").get("last_sequence").asLong());

        when(sessions.calibrate(eq(OWNER), any(SessionService.Capture.class), eq(true)))
                .thenReturn(new SessionService.Calibration(false, 9, "too_few_frames", null));
        send(fake, example("ws-end.json"));
        same(example("ws-calibration-result-failed.json"), fake.only("calibration_result"));
        assertEquals("ended", fake.only("closed").get("reason").asString());
        verify(sessions, never()).openRealtime(anyLong(), any());

        var running = connect(handler);
        send(running, example("ws-hello-calibration.json"));
        send(running, example("ws-features.json"));
        assertEquals("bad_message", running.only("closed").get("reason").asString());
    }

    /** 값이 같은지(숫자는 0과 0.0처럼 표기가 달라도 같은 값이면 같다). */
    private static void same(JsonNode expected, JsonNode actual) {
        Comparator<JsonNode> numbers =
                (a, b) -> a.isNumber() && b.isNumber()
                        ? Double.compare(a.asDouble(), b.asDouble())
                        : a.equals(b) ? 0 : 1;
        assertTrue(expected.equals(numbers, actual), "expected " + expected + " but was " + actual);
    }

    private static SessionUpdates.Progressed ended() {
        var event = new SessionView.DecisionEvent("1.0", SESSION, 4, "session_ended", 600000, 600000, 590000, "none",
                "ended");
        return new SessionUpdates.Progressed(SESSION, null, List.of(new SessionEngine.Decided(event, SUMMARY)), 42,
                SUMMARY, true, null, null);
    }

    /** 시험용 WebSocket 연결. 보낸 메시지를 순서대로 모은다. */
    private static final class Fake {
        private final WebSocketSession socket = mock(WebSocketSession.class);
        private final List<JsonNode> sent = new CopyOnWriteArrayList<>();
        private final AtomicBoolean closed = new AtomicBoolean();

        /** 닫으면 실제 컨테이너처럼 {@code afterConnectionClosed}가 불린다. */
        Fake(String id, RealtimeHandlerV2 owner) throws Exception {
            when(socket.getId()).thenReturn(id);
            when(socket.getPrincipal()).thenReturn(new TestingAuthenticationToken("synthetic", "x", "ROLE_USER"));
            when(socket.isOpen()).thenAnswer(call -> !closed.get());
            doAnswer(call -> {
                        WebSocketMessage<?> message = call.getArgument(0);
                        sent.add(MAPPER.readTree((String) message.getPayload()));
                        return null;
                    })
                    .when(socket)
                    .sendMessage(any());
            doAnswer(call -> {
                        if (closed.compareAndSet(false, true))
                            owner.afterConnectionClosed(socket, call.getArgument(0));
                        return null;
                    })
                    .when(socket)
                    .close(any(CloseStatus.class));
        }

        List<String> types() {
            return sent.stream().map(m -> m.get("type").asString()).toList();
        }

        List<JsonNode> all(String type) {
            return sent.stream().filter(m -> type.equals(m.get("type").asString())).toList();
        }

        /** 그 종류의 첫 메시지. 계약 예시와 필드 이름이 같은지도 확인한다. */
        JsonNode only(String type) throws Exception {
            var found = all(type);
            assertFalse(found.isEmpty(), "no " + type + " in " + types());
            var message = found.get(0);
            assertEquals(fields(example(exampleFor(message))), fields(message), type + " fields");
            return message;
        }

        private static String exampleFor(JsonNode message) {
            String type = message.get("type").asString();
            return switch (type) {
                case "ready" -> "ws-ready-" + message.get("purpose").asString() + ".json";
                case "calibration_result" -> "ws-calibration-result-" + message.get("status").asString() + ".json";
                default -> "ws-" + type + ".json";
            };
        }

        private static Set<String> fields(JsonNode node) {
            var names = new HashSet<String>();
            for (String name : node.propertyNames()) {
                names.add(name);
                if (node.get(name).isObject())
                    for (String inner : node.get(name).propertyNames()) names.add(name + "." + inner);
            }
            return names;
        }
    }
}
