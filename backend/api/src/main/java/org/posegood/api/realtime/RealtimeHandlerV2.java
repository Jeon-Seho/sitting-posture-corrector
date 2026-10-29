package org.posegood.api.realtime;

import tools.jackson.databind.JsonNode;

import jakarta.validation.Validator;

import org.posegood.api.account.AccountService;
import org.posegood.api.account.AuthTokens;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.CanonicalUuidDeserializer;
import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.session.SessionService;
import org.posegood.api.session.SessionUpdates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 실시간 v2 채널({@code /v2/realtime}): 연결 하나가 측정 한 번이다(자정 넘김이면 세션은 둘). 재연결은 없다(ADR 0024).
 * 자세 등록은 B1({@code POST /v2/baselines})로만 한다 — WebSocket 등록({@code purpose: calibration})은 2026-10-27 삭제.
 *
 * 계약: contracts/realtime/realtime-ws.v2.schema.json. 순서는 {@code hello} → {@code ready} → {@code features}
 * (메시지마다 좌표 구간 1개) → {@code end} → {@code closed}. 측정은 좌표에서 특징 변화량을 계산해 HTTP S2와 같은
 * {@link SessionService} 판정 흐름에 넣고(A안), 결과는 세션 변경 이벤트로 받아 보낸다.
 *
 * <p>추론·DB 일시 장애에는 {@code stalled}만 보내고 연결을 유지한다. 그 구간은
 * 다시 받지 않으므로 다음 구간과의 빈 시간은 누락으로 처리된다. 측정 중 연결이 끊기면 마지막으로 받은 구간 끝에서
 * 세션을 끝낸다. 형식·순서가 틀리면 {@code closed(bad_message)}. 좌표·특징 값은 로그에 남기지 않는다.
 *
 * <p>로그인은 hello의 {@code access_token}(JWT)으로 한 번만 확인한다(ADR 0031). 측정 중에는 다시 확인하지 않아
 * 토큰이 만료돼도 연결은 끝까지 간다. 비밀번호 변경·탈퇴 때는 그 사용자의 연결을 바로 닫는다.
 *
 * <p>자정 넘김(BE-6 ① B안, {@code posegood.realtime.midnight-rollover}): KST 자정을 넘는 구간이 오거나 00:00:30까지
 * 구간이 없으면, 이전 세션을 마지막 구간 끝에서 끝내 저장하고 같은 연결을 서버가 만든 새 세션으로 잇는다
 * ({@code session_rollover}). 앱은 시간·순번을 연결 기준으로 계속 보내고, 서버가 자정 위치({@code at_ms})와 순번
 * 기준을 빼서 새 세션 값으로 바꾼다. {@code ack}·{@code progress}·{@code stalled}의 순번은 앱이 보낸 번호 그대로다.
 * 자정에 걸친 구간과 넘긴 뒤 늦게 온 자정 전 구간은 어느 세션에도 넣지 않는다.
 */
@Component
public class RealtimeHandlerV2 extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(RealtimeHandlerV2.class);
    static final int MAX_BYTES = 64 * 1024;
    private static final Set<String> HELLO_MEASURE =
            Set.of("type", "schema_version", "purpose", "session_id", "access_token");
    private static final Set<String> FEATURES = Set.of("type", "items");
    private static final Set<String> END = Set.of("type", "end_ms");
    private static final String DAY_CHANGED = "day_changed";

    private final SessionService sessions;
    private final CurrentUser current;
    private final AuthTokens tokens;
    private final Json json;
    private final Validator validator;
    private final Duration helloTimeout;
    private final Duration readyTimeout;
    /** 자정에 같은 연결에서 새 세션으로 넘길지. 끄면 세션은 자정을 넘어 이어진다. */
    private final boolean midnightRollover;
    private final Clock clock;
    private final ScheduledExecutorService timer =
            Executors.newSingleThreadScheduledExecutor(
                    work -> {
                        var thread = new Thread(work, "realtime-v2-hello");
                        thread.setDaemon(true);
                        return thread;
                    });
    private final ConcurrentHashMap<String, Channel> channels = new ConcurrentHashMap<>();
    /** 측정 세션마다 연결은 하나다(자정 넘김 뒤에는 새 세션으로 옮긴다). */
    private final ConcurrentHashMap<UUID, Channel> bySession = new ConcurrentHashMap<>();

    @Autowired
    public RealtimeHandlerV2(
            SessionService sessions,
            CurrentUser current,
            AuthTokens tokens,
            Json json,
            Validator validator,
            @Value("${posegood.realtime.hello-timeout}") Duration helloTimeout,
            @Value("${posegood.realtime.ready-timeout}") Duration readyTimeout,
            @Value("${posegood.realtime.midnight-rollover}") boolean midnightRollover) {
        this(sessions, current, tokens, json, validator, helloTimeout, readyTimeout, midnightRollover,
                Clock.systemUTC());
    }

    RealtimeHandlerV2(
            SessionService sessions,
            CurrentUser current,
            AuthTokens tokens,
            Json json,
            Validator validator,
            Duration helloTimeout,
            Duration readyTimeout,
            boolean midnightRollover,
            Clock clock) {
        this.sessions = sessions;
        this.current = current;
        this.tokens = tokens;
        this.json = json;
        this.validator = validator;
        this.helloTimeout = helloTimeout;
        this.readyTimeout = readyTimeout;
        this.midnightRollover = midnightRollover;
        this.clock = clock;
    }

    /** 새 연결: hello를 기다린다. 제한 시간 안에 없으면 {@code closed(bad_message)}. */
    @Override
    public void afterConnectionEstablished(WebSocketSession socket) {
        var channel = new Channel(new ConcurrentWebSocketSessionDecorator(socket, 5000, 1 << 20));
        channels.put(socket.getId(), channel);
        channel.timeout =
                timer.schedule(
                        () -> {
                            if (channel.state.compareAndSet(State.WAITING, State.CLOSING))
                                closed(channel, "bad_message");
                        },
                        helloTimeout.toMillis(),
                        TimeUnit.MILLISECONDS);
    }

    /** 연결이 끊김: 측정 중이었으면 마지막으로 받은 구간 끝에서 세션을 끝낸다(ADR 0024). 등록은 저장하지 않는다. */
    @Override
    public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
        var channel = channels.remove(socket.getId());
        if (channel == null) return;
        channel.state.set(State.CLOSING);
        if (channel.timeout != null) channel.timeout.cancel(false);
        synchronized (channel) { // 자정 넘김 중이면 넘긴 뒤의 세션을 끝낸다
            UUID id = channel.session;
            if (id == null || !bySession.remove(id, channel) || channel.ended) return;
            try {
                sessions.finish(channel.owner, id, null);
            } catch (ApiError | DataAccessException gone) {
                log.debug("realtime v2 disconnect end skipped: {}", gone.getClass().getSimpleName());
            }
        }
    }

    /** 메시지 처리: 상태에 맞는 종류만 받는다. */
    @Override
    protected void handleTextMessage(WebSocketSession socket, TextMessage message) {
        var channel = channels.get(socket.getId());
        if (channel == null || channel.state.get() == State.CLOSING) return;
        if (message.getPayloadLength() > MAX_BYTES) {
            reject(channel);
            return;
        }
        JsonNode frame;
        try {
            frame = json.mapper().readTree(message.getPayload());
        } catch (RuntimeException unreadable) { // Jackson 3 parse errors are unchecked (JacksonException)
            reject(channel);
            return;
        }
        String type = Json.text(frame.path("type"));
        switch (channel.state.get()) {
            case WAITING -> {
                if (!"hello".equals(type) || !channel.state.compareAndSet(State.WAITING, State.PREPARING)) {
                    reject(channel);
                    return;
                }
                channel.timeout.cancel(false);
                hello(channel, socket, frame);
            }
            case MEASURE -> {
                switch (type) {
                    case "features" -> measure(channel, frame);
                    case "end" -> endMeasure(channel, frame);
                    default -> reject(channel);
                }
            }
            default -> reject(channel);
        }
    }

    /** hello: 측정({@code purpose: measure})만 받는다. 확인 뒤 {@code ready}를 보낸다. */
    private void hello(Channel channel, WebSocketSession socket, JsonNode frame) {
        long started = System.nanoTime();
        if (!"2.0".equals(Json.text(frame.path("schema_version"), null))
                || !"measure".equals(Json.text(frame.path("purpose"), null))
                || !exactly(frame, HELLO_MEASURE)) {
            reject(channel);
            return;
        }
        UUID id = uuid(frame.path("session_id"));
        if (id == null) {
            reject(channel);
            return;
        }
        try {
            channel.owner = current.id(tokens.authenticate(Json.text(frame.path("access_token"), null)));
            channel.realtime = sessions.openRealtime(channel.owner, id);
        } catch (ApiError refused) {
            finishClosed(channel, refusal(refused));
            return;
        } catch (DataAccessException storage) {
            finishClosed(channel, "session_lost");
            return;
        }
        if (bySession.putIfAbsent(id, channel) != null) { // 같은 세션에 이미 연결이 있다
            reject(channel);
            return;
        }
        channel.session = id;
        if (System.nanoTime() - started > readyTimeout.toNanos()) {
            // 앱은 이미 ready를 기다리지 않는다(api-ws-spec 1.1). 그 세션은 끝난 것으로 본다.
            finishClosed(channel, "session_lost");
            return;
        }
        nextMidnight(channel);
        channel.state.set(State.MEASURE);
        send(channel, new RealtimeMessages.V2.ReadyMeasure(id, channel.realtime.startedAt()));
    }

    /** 측정 구간 하나: 특징 계산·추론·판정. observation·decision·alert는 이벤트로, 끝나면 ack·progress. */
    private void measure(Channel channel, JsonNode frame) {
        var interval = interval(frame);
        if (interval == null) {
            reject(channel);
            return;
        }
        synchronized (channel) {
            if (channel.state.get() != State.MEASURE) return;
            if (interval.endMs() >= channel.cutMs && !rollover(channel)) return;
            if (interval.startMs() < channel.offsetMs || interval.sequence() < channel.sequenceOffset) {
                // 자정에 걸쳤거나 넘긴 뒤 늦게 온 자정 전 구간: 어느 세션에도 넣지 않고 받았다고만 알린다.
                channel.lastSequence = Math.max(channel.lastSequence, interval.sequence());
                send(channel, new RealtimeMessages.V2.Ack(channel.lastSequence));
                return;
            }
            UUID id = channel.session;
            try {
                var local = interval.shifted(channel.offsetMs, channel.sequenceOffset);
                var status = sessions.frames(channel.owner, id, local, channel.realtime.baseline());
                long last = status.lastSequence() + channel.sequenceOffset;
                channel.lastSequence = last;
                send(channel, new RealtimeMessages.V2.Ack(last));
                send(channel, new RealtimeMessages.V2.Progress(last, status.summary(), status.pausedReason()));
            } catch (ApiError refused) {
                if (refused.status() == 502 || refused.status() == 503) {
                    stalled(channel);
                } else if (refused.status() == 429) {
                    channel.endReason = "limit_reached";
                    end(channel, null);
                } else if ("SESSION_ENDED".equals(refused.code())) {
                    finishClosed(channel, "ended");
                } else if (refused.status() == 400 || refused.status() == 409) {
                    reject(channel);
                } else {
                    finishClosed(channel, refusal(refused));
                }
            } catch (DataAccessException storage) {
                stalled(channel);
            }
        }
    }

    /** 측정 end: 최종 {@code decision(session_ended)}과 {@code closed(ended)}는 세션 이벤트로 보낸다. */
    private void endMeasure(Channel channel, JsonNode frame) {
        Long endMs = endMs(frame);
        if (endMs == null) {
            reject(channel);
            return;
        }
        synchronized (channel) {
            if (channel.state.get() != State.MEASURE) return;
            // end_ms는 연결 기준이다. 넘기기 전에 자정을 지났으면 자정 직전에서 끝낸다(종료 날짜 = 시작 날짜).
            end(channel, Math.max(0, Math.min(endMs, channel.cutMs - 1) - channel.offsetMs));
        }
    }

    /**
     * 자정 넘김: 이전 세션을 끝내 저장하고 같은 연결을 서버가 만든 새 세션으로 잇는다. 넘겼으면 true.
     *
     * 새 세션을 만들지 못하면 {@code closed(day_changed)}로 닫는다. 앱은 새 S1부터 다시 시작한다.
     */
    private boolean rollover(Channel channel) {
        UUID previous = channel.session;
        long at = channel.cutMs;
        SessionService.Rollover next;
        try {
            next = sessions.rollover(channel.owner, previous, channel.midnight, SessionEngine.DEFAULT_MAX_MS - at);
        } catch (ApiError | DataAccessException failed) {
            log.warn("realtime v2 midnight rollover failed: {}", failed.getClass().getSimpleName());
            if (channel.dayEnded) {
                channel.ended = true;
                finishClosed(channel, DAY_CHANGED);
            } else if (failed instanceof ApiError refused) {
                finishClosed(channel, "SESSION_ENDED".equals(refused.code()) ? "ended" : refusal(refused));
            } else {
                finishClosed(channel, "session_lost");
            }
            return false;
        }
        bySession.remove(previous, channel);
        channel.session = next.sessionId();
        channel.realtime = new SessionService.Realtime(channel.realtime.baseline(), next.alertEnabled(), next.startedAt());
        channel.offsetMs = at;
        channel.sequenceOffset = channel.lastSequence + 1;
        channel.dayEnded = false;
        channel.endedAt = null;
        bySession.put(next.sessionId(), channel);
        nextMidnight(channel);
        send(channel, new RealtimeMessages.V2.SessionRollover(
                previous, next.endedAt(), next.ended(), next.sessionId(), next.startedAt(), at));
        return true;
    }

    /** 지금 세션의 다음 KST 자정과 그 위치(연결 기준 ms). 넘김을 껐거나 연결의 시간 상한(24시간) 밖이면 넘기지 않는다. */
    private void nextMidnight(Channel channel) {
        var midnight = KstTime.nextMidnight(channel.realtime.startedAt());
        long at = channel.offsetMs + Duration.between(channel.realtime.startedAt(), midnight).toMillis();
        channel.midnight = midnight;
        channel.cutMs = midnightRollover && at < SessionEngine.DEFAULT_MAX_MS ? at : Long.MAX_VALUE;
    }

    /** 자정 30초 뒤: 자정을 넘는 구간이 오지 않은 연결(쉬기 중 등)도 넘긴다. 30초는 늦게 오는 구간을 기다리는 여유다. */
    @Scheduled(cron = "30 0 0 * * *", zone = "Asia/Seoul")
    public void midnight() {
        var now = clock.instant();
        for (var channel : channels.values()) {
            synchronized (channel) {
                if (channel.state.get() == State.MEASURE
                        && channel.cutMs != Long.MAX_VALUE
                        && !channel.midnight.isAfter(now)) rollover(channel);
            }
        }
    }

    private void end(Channel channel, Long endMs) {
        try {
            sessions.finish(channel.owner, channel.session, endMs);
        } catch (ApiError refused) {
            if (refused.status() == 503) {
                stalled(channel);
                return;
            }
            finishClosed(channel, refusal(refused));
            return;
        } catch (DataAccessException storage) {
            // 판정은 끝났고 이벤트로 closed를 이미 보냈다. 열린 세션 행은 기록 저장(S3·R2) 때 닫힌다.
            log.warn("realtime v2 end persist failed: {}", storage.getClass().getSimpleName());
        }
        if (channel.state.get() != State.CLOSING) finishClosed(channel, channel.endReason);
    }

    /**
     * 세션에 새 결과가 생기면 그 세션의 v2 연결에 보낸다: observation → decision(→ alert) → 끝났으면 closed.
     *
     * 알림을 끈 세션에는 alert를 보내지 않는다.
     */
    @EventListener
    public void progressed(SessionUpdates.Progressed update) {
        var channel = bySession.get(update.sessionId());
        if (channel == null) return;
        if (update.live() != null) send(channel, new RealtimeMessages.V2.ObservationPush(update.live()));
        for (var decided : update.decided()) {
            var event = decided.event();
            send(channel, new RealtimeMessages.V2.Decision(event, decided.summary()));
            if (channel.realtime.alertEnabled()
                    && ("collapse_confirmed".equals(event.kind()) || "reminder".equals(event.kind())))
                send(channel, new RealtimeMessages.V2.Alert(event));
        }
        if (update.ended()) {
            // DB에 저장하는 종료 시각과 같은 식(started_at + total_ms). 저장은 이 이벤트 뒤에 일어난다.
            channel.endedAt = channel.realtime.startedAt().plusMillis(update.summary().totalMs());
            if (DAY_CHANGED.equals(update.closedReason())) { // 자정 넘김: 닫지 않고 새 세션으로 잇는다(rollover)
                channel.dayEnded = true;
                return;
            }
            channel.ended = true;
            finishClosed(channel, update.closedReason() != null ? update.closedReason() : channel.endReason);
        }
    }

    /** 세션이 메모리에서 빠지면 연결을 닫는다. */
    @EventListener
    public void removed(SessionUpdates.Removed removed) {
        var channel = bySession.get(removed.sessionId());
        if (channel != null) finishClosed(channel, removed.reason());
    }

    /** 비밀번호 변경·탈퇴로 로그인이 지워지면 그 사용자의 연결을 닫는다. */
    @EventListener
    public void loginsRemoved(AccountService.LoginsRemoved removed) {
        for (var channel : channels.values()) {
            if (channel.owner != removed.userId()) continue;
            finishClosed(channel, "unauthorized");
        }
    }

    /** 서버 종료: 앱은 다시 연결하지 않는다. 측정 세션은 연결 종료 처리로 끝난다. */
    @jakarta.annotation.PreDestroy
    public void shutdown() {
        for (var channel : channels.values()) finishClosed(channel, "server_shutdown");
        timer.shutdownNow();
    }

    private static String refusal(ApiError refused) {
        if (refused.status() == 401 || refused.status() == 403) return "unauthorized";
        if ("SESSION_NOT_FOUND".equals(refused.code())) return "not_owner";
        if ("BASELINE_REQUIRED".equals(refused.code())) return "no_baseline";
        return "session_lost";
    }

    /** features의 구간 1개. 형식이 틀리거나 1개가 아니면 null. */
    private FrameInterval interval(JsonNode frame) {
        var items = frame.path("items");
        if (!exactly(frame, FEATURES) || !items.isArray() || items.size() != 1) return null;
        try {
            var interval = json.convert(items.get(0), FrameInterval.class);
            return validator.validate(interval).isEmpty() ? interval : null;
        } catch (ApiError invalid) {
            return null;
        }
    }

    private static Long endMs(JsonNode frame) {
        var value = frame.path("end_ms");
        if (!exactly(frame, END) || !value.isIntegralNumber() || !value.canConvertToLong()) return null;
        long endMs = value.asLong();
        return endMs < 0 || endMs > 86_400_000L ? null : endMs;
    }

    private void stalled(Channel channel) {
        send(channel, new RealtimeMessages.V2.Stalled(channel.lastSequence));
    }

    private void reject(Channel channel) {
        finishClosed(channel, "bad_message");
    }

    /** 더 받지 않는 상태로 바꾸고 {@code closed(reason)}를 보낸다. */
    private void finishClosed(Channel channel, String reason) {
        channel.state.set(State.CLOSING);
        closed(channel, reason);
    }

    /** {@code closed(reason)}를 보내고 닫는다. 한 연결에 한 번만. */
    private void closed(Channel channel, String reason) {
        if (!channel.closedSent.compareAndSet(false, true)) return;
        send(channel, new RealtimeMessages.V2.Closed(reason, channel.endedAt));
        close(channel, CloseStatus.NORMAL);
    }

    private void send(Channel channel, Object message) {
        try {
            if (channel.socket.isOpen()) channel.socket.sendMessage(new TextMessage(json.write(message)));
        } catch (IOException | RuntimeException failed) {
            log.debug("realtime v2 send failed: {}", failed.getClass().getSimpleName());
            close(channel, CloseStatus.SESSION_NOT_RELIABLE);
        }
    }

    private static void close(Channel channel, CloseStatus status) {
        try {
            if (channel.socket.isOpen()) channel.socket.close(status);
        } catch (IOException ignored) {
            // 상대가 이미 닫았다.
        }
    }

    private static UUID uuid(JsonNode node) {
        var text = Json.text(node, null);
        if (text == null || !CanonicalUuidDeserializer.CANONICAL.matcher(text).matches()) return null;
        return UUID.fromString(text);
    }

    private static boolean exactly(JsonNode frame, Set<String> keys) {
        if (!frame.isObject() || frame.size() != keys.size()) return false;
        for (String name : frame.propertyNames())
            if (!keys.contains(name)) return false;
        return true;
    }

    private enum State {
        /** hello를 기다림. */
        WAITING,
        /** hello 확인 중. */
        PREPARING,
        MEASURE,
        /** closed를 보냈거나 끊김. */
        CLOSING
    }

    /** 연결 하나의 상태. 메시지는 연결마다 차례로 오고, 이벤트·타이머만 다른 스레드에서 온다. */
    private static final class Channel {
        private final WebSocketSession socket;
        private final AtomicReference<State> state = new AtomicReference<>(State.WAITING);
        private volatile ScheduledFuture<?> timeout;
        private final AtomicBoolean closedSent = new AtomicBoolean();
        private volatile long owner;
        /** 측정: 세션 ID와 준비 결과. */
        private volatile UUID session;
        private volatile SessionService.Realtime realtime;
        /** 마지막으로 받은 구간 순번(앱이 보낸 번호, 연결 기준). */
        private volatile long lastSequence = -1;
        /** 지금 세션의 다음 KST 자정과 그 위치(연결 기준 ms). 넘기지 않으면 {@link Long#MAX_VALUE}. */
        private volatile Instant midnight;
        private volatile long cutMs = Long.MAX_VALUE;
        /** 지금 세션이 시작한 자리(연결 기준 ms)와 순번 기준. 앱 값에서 빼면 세션 값이다(넘기기 전에는 0). */
        private volatile long offsetMs;
        private volatile long sequenceOffset;
        /** 이전 세션이 자정 넘김으로 끝났고 아직 새 세션으로 잇지 않았다. */
        private volatile boolean dayEnded;
        /** 세션이 끝났다는 이벤트를 받았다(연결이 닫혀도 다시 끝내지 않는다). */
        private volatile boolean ended;
        /** 이 연결에서 세션이 끝났을 때의 서버 종료 시각. closed에 싣는다(그 전에는 null). */
        private volatile Instant endedAt;
        /** 세션이 끝났을 때 보낼 closed 사유(시간 한도면 limit_reached). */
        private volatile String endReason = "ended";

        private Channel(WebSocketSession socket) {
            this.socket = socket;
        }
    }
}
