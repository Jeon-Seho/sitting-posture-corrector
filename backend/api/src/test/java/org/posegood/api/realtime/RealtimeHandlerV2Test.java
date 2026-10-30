package org.posegood.api.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
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
import org.posegood.api.account.AccountService;
import org.posegood.api.account.AuthTokens;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.session.SessionService;
import org.posegood.api.session.SessionUpdates;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
    /** 세션 기준 자세(추론에 함께 넘긴다). 값은 이 시험에서 쓰지 않는다. */
    private static final SessionRequests.Landmarks BASELINE = baseline();
    /** 자정 넘김으로 서버가 만든 새 세션. */
    private static final UUID NEXT = UUID.fromString("5d0b8f3a-1c2e-4a6b-9d7f-0e1a2b3c4d5e");
    /** STARTED(KST 10:00:00.120) 다음의 KST 자정과 그 위치(앱이 보내는 시간축, 연결 기준 ms). */
    private static final Instant MIDNIGHT = Instant.parse("2026-10-26T15:00:00Z");
    private static final long AT = 50_399_880;

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
        return handler(hello, false, Clock.systemUTC());
    }

    private RealtimeHandlerV2 handler(Duration hello, boolean midnightRollover, Clock clock) {
        var current = mock(CurrentUser.class);
        when(current.id(any(Authentication.class))).thenReturn(OWNER);
        // 예시 hello의 access_token만 유효하다(ADR 0031). 그 밖의 토큰은 401.
        var tokens = mock(AuthTokens.class);
        when(tokens.authenticate(any())).thenThrow(new ApiError(401, "UNAUTHENTICATED", "authentication required"));
        doReturn(UsernamePasswordAuthenticationToken.authenticated("synthetic", null, java.util.List.of()))
                .when(tokens).authenticate("synthetic-access-token");
        return new RealtimeHandlerV2(sessions, current, tokens, new Json(MAPPER),
                Validation.buildDefaultValidatorFactory().getValidator(), hello, Duration.ofSeconds(5),
                midnightRollover, clock);
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

    private static SessionRequests.Landmarks baseline() {
        var p = new SessionRequests.Point[9];
        for (int i = 0; i < 9; i++) p[i] = new SessionRequests.Point(0.5, 0.5);
        return new SessionRequests.Landmarks(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
    }

    /** 판정한 묶음 하나(계획 0064): 관측 4.0, 그 뒤 progress. */
    private static SessionUpdates.Progressed batch(UUID session, long lastSequence) {
        return new SessionUpdates.Progressed(session, List.of(), lastSequence, SUMMARY, false,
                Observation.V4.judged("bad", 0.82), null, null);
    }

    /** 묶음 대역: flush하면 그 세션의 묶음 결과가 이벤트로 온다. */
    private void judges(UUID session, long lastSequence) {
        doAnswer(call -> {
                    handler.progressed(batch(session, lastSequence));
                    return null;
                })
                .when(sessions)
                .flush(OWNER, session);
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

    /** 자정 넘김을 켠 서버로 측정을 시작한다. */
    private Fake rolling(Clock clock) throws Exception {
        handler.shutdown();
        handler = handler(Duration.ofSeconds(10), true, clock);
        return measuring();
    }

    /** 예시 features의 순번·시간만 바꾼 구간(앱이 보내는 연결 기준 값). */
    private static ObjectNode features(long sequence, long startMs, long endMs) throws Exception {
        var message = example("ws-features.json");
        ((ObjectNode) message.get("items").get(0)).put("sequence", sequence).put("start_ms", startMs).put("end_ms", endMs);
        return message;
    }

    /** 넘김 대역: 이전 세션 종료 이벤트(day_changed)를 보낸 뒤 새 세션을 돌려준다. */
    private void rollsOver() {
        doAnswer(call -> {
                    handler.progressed(ended("day_changed"));
                    return new SessionService.Rollover(SUMMARY, STARTED.plusMillis(SUMMARY.totalMs()), NEXT, MIDNIGHT, true);
                })
                .when(sessions)
                .rollover(OWNER, SESSION, MIDNIGHT, SessionEngine.DEFAULT_MAX_MS - AT);
    }

    @Test
    void measurementRunsHelloReadyFeaturesEnd() throws Exception {
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE))).thenReturn(42L);
        judges(SESSION, 42);
        send(fake, example("ws-features.json"));
        // 받은 즉시 ack, 묶음을 판정하면 observation → progress(계획 0064).
        assertEquals(List.of("ready", "ack", "observation", "progress"), fake.types());
        assertEquals(42, fake.only("ack").get("last_sequence").asLong());
        same(example("ws-observation.json"), fake.only("observation"));
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
        assertEquals(List.of("ready", "ack", "observation", "progress", "decision", "closed"), kinds);
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
        handler.progressed(new SessionUpdates.Progressed(SESSION,
                List.of(new SessionEngine.Decided(event, SUMMARY)), 42, SUMMARY, false,
                Observation.V4.judged("bad", 0.82), null, null));
        assertEquals(List.of("ready", "observation", "decision", "alert", "progress"), fake.types());
        same(example("ws-observation.json"), fake.only("observation"));
        same(example("ws-decision.json"), fake.only("decision"));
        same(example("ws-alert.json"), fake.only("alert"));

        handler.progressed(new SessionUpdates.Progressed(SESSION, List.of(), 43, SUMMARY, false,
                Observation.V4.unjudged("unmeasurable"), "unmeasurable", null));
        same(example("ws-observation-unmeasurable.json"), fake.all("observation").get(1));
        assertEquals("unmeasurable", fake.all("progress").get(1).get("paused_reason").asString());
        assertFalse(fake.closed.get());
    }

    @Test
    void alertsAreNotSentWhenTheSessionTurnedThemOff() throws Exception {
        when(sessions.openRealtime(OWNER, SESSION)).thenReturn(new SessionService.Realtime(BASELINE, false, STARTED));
        var fake = connect(handler);
        send(fake, example("ws-hello-measure.json"));
        var event = new SessionView.DecisionEvent("1.0", SESSION, 1, "collapse_confirmed", 21000, 18000, 17000,
                "forward_slouch", null);
        handler.progressed(new SessionUpdates.Progressed(SESSION,
                List.of(new SessionEngine.Decided(event, SUMMARY)), 42, SUMMARY, false, null, null, null));
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
        var calibrationPhase = example("ws-features.json");
        ((ObjectNode) calibrationPhase.get("items").get(0)).put("phase", "calibration"); // 등록 구간은 더 받지 않음
        send(wrongPhase, calibrationPhase);
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

        var anonymous = connect(handler);
        send(anonymous, example("ws-hello-measure.json").put("access_token", "expired-access-token"));
        assertEquals("unauthorized", anonymous.only("closed").get("reason").asString());
        // 받아들여지지 않은 연결이 끊겨도 세션을 끝내지 않는다.
        verify(sessions, never()).finish(anyLong(), any(), any());
    }

    @Test
    void inferenceFailureSendsStalledAndKeepsTheConnection() throws Exception {
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE))).thenReturn(42L);
        doThrow(ApiError.upstream("inference unavailable")).when(sessions).flush(OWNER, SESSION);
        send(fake, example("ws-features.json"));
        assertEquals(List.of("ready", "ack", "stalled"), fake.types());
        assertEquals(42, fake.only("stalled").get("since_last_sequence").asLong());
        // 서버가 스스로 넘긴 묶음(3초 지남)이 실패해도 같은 연결로 알린다.
        handler.stalled(new SessionUpdates.Stalled(SESSION));
        assertEquals(2, fake.all("stalled").size());
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
    void unmeasurableTimeoutClosesWithItsReasonAndTheEndTime() throws Exception {
        // 서버가 측정불가 시간 초과로 끝내면 그 묶음 처리 중에 세션 이벤트가 온다(끝났으므로 progress는 없다).
        var fake = measuring();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE))).thenReturn(42L);
        doAnswer(call -> {
                    handler.progressed(ended("unmeasurable_timeout"));
                    return null;
                })
                .when(sessions)
                .flush(OWNER, SESSION);
        send(fake, example("ws-features.json"));
        assertEquals(List.of("ready", "ack", "decision", "closed"), fake.types());
        var closed = fake.only("closed");
        assertEquals("unmeasurable_timeout", closed.get("reason").asString());
        assertEquals(STARTED.plusMillis(SUMMARY.totalMs()), Instant.parse(closed.get("ended_at").asString()));
        verify(sessions, never()).finish(eq(OWNER), eq(SESSION), any());
    }

    @Test
    void midnightRolloverContinuesInANewSessionOnTheSameConnection() throws Exception {
        var fake = rolling(Clock.systemUTC());
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE))).thenReturn(42L);
        judges(SESSION, 42);
        send(fake, features(42, AT - 1000, AT - 500));
        // 자정에 걸친 구간: 이전 세션을 끝내 저장하고 새 세션으로 넘긴 뒤, 그 구간은 버리고 받았다고만 알린다.
        rollsOver();
        send(fake, features(43, AT - 300, AT + 200));
        assertEquals(List.of("ready", "ack", "observation", "progress", "decision", "session_rollover", "ack"),
                fake.types());
        assertEquals("session_ended", fake.only("decision").get("event").get("kind").asString());
        same(example("ws-session-rollover.json"), fake.only("session_rollover"));
        assertEquals(43, fake.all("ack").get(1).get("last_sequence").asLong());
        assertFalse(fake.closed.get());

        // 넘긴 뒤: 앱은 연결 기준 시간·순번을 그대로 보내고 서버가 새 세션 값(자정 = 0, 순번 43 = 0)으로 바꾼다.
        // ack·progress의 순번은 앱이 보낸 번호 그대로다.
        var received = new ArrayList<FrameInterval>();
        when(sessions.frames(eq(OWNER), eq(NEXT), any(FrameInterval.class), eq(BASELINE)))
                .thenAnswer(call -> {
                    received.add(call.getArgument(2));
                    return 1L;
                });
        judges(NEXT, 1);
        send(fake, features(44, AT + 200, AT + 700));
        var local = received.get(0);
        assertEquals(List.of(1L, 200L, 700L), List.of(local.sequence(), local.startMs(), local.endMs()));
        // 프레임 t_ms도 새 세션 기준으로 옮긴다(프레임 길이를 t_ms로 센다).
        long sent = example("ws-features.json").get("items").get(0).get("frames").get(0).get("t_ms").asLong();
        assertEquals(Math.max(0, sent - AT), local.frames().get(0).tMs());
        assertEquals(44, fake.all("ack").get(2).get("last_sequence").asLong());
        assertEquals(44, fake.all("progress").get(1).get("last_sequence").asLong());

        // end_ms도 새 세션 기준으로 바꿔 새 세션을 끝낸다. 이전 세션은 다시 끝내지 않는다.
        send(fake, example("ws-end.json").put("end_ms", AT + 1000));
        verify(sessions).finish(OWNER, NEXT, 1000L);
        verify(sessions, never()).finish(eq(OWNER), eq(SESSION), any());
    }

    @Test
    void connectionsWithoutIntervalsRollOverHalfAMinuteAfterMidnight() throws Exception {
        var fake = rolling(Clock.fixed(MIDNIGHT.plusSeconds(30), ZoneOffset.UTC));
        rollsOver();
        handler.midnight();
        assertEquals(List.of("ready", "decision", "session_rollover"), fake.types());
        // 넘긴 뒤 늦게 온 자정 전 구간은 어느 세션에도 넣지 않는다.
        send(fake, features(0, AT - 500, AT));
        assertEquals(List.of("ready", "decision", "session_rollover", "ack"), fake.types());
        verify(sessions, never()).frames(anyLong(), any(), any(), any());
        assertFalse(fake.closed.get());
    }

    @Test
    void rolloverIsOffByDefaultAndNeverBeforeMidnight() throws Exception {
        var off = measuring();
        handler.midnight();
        when(sessions.frames(eq(OWNER), eq(SESSION), any(FrameInterval.class), eq(BASELINE))).thenReturn(43L);
        judges(SESSION, 43);
        send(off, features(43, AT - 300, AT + 200)); // 끄면 세션은 자정을 넘어 이어진다
        assertEquals(List.of("ready", "ack", "observation", "progress"), off.types());

        var early = rolling(Clock.fixed(MIDNIGHT.minusSeconds(1), ZoneOffset.UTC));
        handler.midnight();
        assertEquals(List.of("ready"), early.types());
        verify(sessions, never()).rollover(anyLong(), any(), any(), anyLong());
    }

    @Test
    void failedRolloverClosesWithDayChangedAndTheEndTime() throws Exception {
        // 이전 세션은 끝나 저장됐지만 새 세션을 못 만들면(자리 없음 등) 닫는다. 앱은 새 S1부터 다시 시작한다.
        var fake = rolling(Clock.systemUTC());
        doAnswer(call -> {
                    handler.progressed(ended("day_changed"));
                    throw ApiError.limit("live session capacity reached");
                })
                .when(sessions)
                .rollover(OWNER, SESSION, MIDNIGHT, SessionEngine.DEFAULT_MAX_MS - AT);
        send(fake, features(43, AT - 300, AT + 200));
        assertEquals(List.of("ready", "decision", "closed"), fake.types());
        var closed = fake.only("closed");
        assertEquals("day_changed", closed.get("reason").asString());
        assertEquals(STARTED.plusMillis(SUMMARY.totalMs()), Instant.parse(closed.get("ended_at").asString()));
        verify(sessions, never()).finish(anyLong(), any(), any());
        verify(sessions, never()).frames(anyLong(), any(), any(), any());
    }

    @Test
    void endAfterMidnightBeforeAnyRolloverEndsJustBeforeMidnight() throws Exception {
        var fake = rolling(Clock.systemUTC());
        send(fake, example("ws-end.json").put("end_ms", AT + 5000));
        verify(sessions).finish(OWNER, SESSION, AT - 1); // 종료 날짜가 시작 날짜와 같게
    }

    @Test
    void removedLoginsCloseOnlyThatUsersConnections() throws Exception {
        // 측정 중에는 토큰을 다시 확인하지 않는다. 비밀번호 변경·탈퇴만 hello 때 정한 사용자로 찾아 바로 닫는다.
        var fake = measuring();
        handler.loginsRemoved(new AccountService.LoginsRemoved(OWNER + 1));
        assertFalse(fake.closed.get());
        handler.loginsRemoved(new AccountService.LoginsRemoved(OWNER));
        assertEquals("unauthorized", fake.only("closed").get("reason").asString());
    }

    @Test
    void calibrationIsNoLongerAccepted() throws Exception {
        // WebSocket 자세 등록은 2026-10-27 삭제(B1만). purpose: calibration hello는 계약 위반이다.
        var fake = connect(handler);
        var hello = example("ws-hello-measure.json").put("purpose", "calibration");
        send(fake, hello);
        assertEquals("bad_message", fake.only("closed").get("reason").asString());
        verify(sessions, never()).openRealtime(anyLong(), any());
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
        return ended(null);
    }

    private static SessionUpdates.Progressed ended(String closedReason) {
        var event = new SessionView.DecisionEvent("1.0", SESSION, 4, "session_ended", 600000, 600000, 590000, "none",
                "ended");
        return new SessionUpdates.Progressed(SESSION, List.of(new SessionEngine.Decided(event, SUMMARY)), 42,
                SUMMARY, true, null, null, closedReason);
    }

    /** 시험용 WebSocket 연결. 보낸 메시지를 순서대로 모은다. */
    private static final class Fake {
        private final WebSocketSession socket = mock(WebSocketSession.class);
        private final List<JsonNode> sent = new CopyOnWriteArrayList<>();
        private final AtomicBoolean closed = new AtomicBoolean();

        /** 닫으면 실제 컨테이너처럼 {@code afterConnectionClosed}가 불린다. */
        Fake(String id, RealtimeHandlerV2 owner) throws Exception {
            when(socket.getId()).thenReturn(id);
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
                default -> "ws-" + type.replace('_', '-') + ".json";
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
