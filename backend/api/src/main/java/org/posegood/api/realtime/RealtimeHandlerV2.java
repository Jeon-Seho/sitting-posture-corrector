package org.posegood.api.realtime;

import tools.jackson.databind.JsonNode;

import jakarta.validation.Validator;

import org.posegood.api.account.AccountService;
import org.posegood.api.account.AuthTokens;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.CanonicalUuidDeserializer;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.session.SessionService;
import org.posegood.api.session.SessionUpdates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
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
 * 실시간 v2 채널({@code /v2/realtime}): 연결 하나가 측정 한 번 또는 자세 등록 한 번이다. 재연결은 없다(ADR 0024).
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
 */
@Component
public class RealtimeHandlerV2 extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(RealtimeHandlerV2.class);
    static final int MAX_BYTES = 64 * 1024;
    private static final Set<String> HELLO_MEASURE =
            Set.of("type", "schema_version", "purpose", "session_id", "access_token");
    private static final Set<String> HELLO_CALIBRATION =
            Set.of("type", "schema_version", "purpose", "calibration_id", "access_token");
    private static final Set<String> FEATURES = Set.of("type", "items");
    private static final Set<String> END = Set.of("type", "end_ms");

    private final SessionService sessions;
    private final CurrentUser current;
    private final AuthTokens tokens;
    private final Json json;
    private final Validator validator;
    private final Duration helloTimeout;
    private final Duration readyTimeout;
    private final ScheduledExecutorService timer =
            Executors.newSingleThreadScheduledExecutor(
                    work -> {
                        var thread = new Thread(work, "realtime-v2-hello");
                        thread.setDaemon(true);
                        return thread;
                    });
    private final ConcurrentHashMap<String, Channel> channels = new ConcurrentHashMap<>();
    /** 측정 세션마다 연결은 하나다. */
    private final ConcurrentHashMap<UUID, Channel> bySession = new ConcurrentHashMap<>();

    public RealtimeHandlerV2(
            SessionService sessions,
            CurrentUser current,
            AuthTokens tokens,
            Json json,
            Validator validator,
            @Value("${posegood.realtime.hello-timeout}") Duration helloTimeout,
            @Value("${posegood.realtime.ready-timeout}") Duration readyTimeout) {
        this.sessions = sessions;
        this.current = current;
        this.tokens = tokens;
        this.json = json;
        this.validator = validator;
        this.helloTimeout = helloTimeout;
        this.readyTimeout = readyTimeout;
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
        UUID id = channel.session;
        if (id == null || !bySession.remove(id, channel) || channel.ended) return;
        try {
            sessions.finish(channel.owner, id, null);
        } catch (ApiError | DataAccessException gone) {
            log.debug("realtime v2 disconnect end skipped: {}", gone.getClass().getSimpleName());
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
            case CALIBRATION -> {
                switch (type) {
                    case "features" -> capture(channel, frame);
                    case "end" -> endCalibration(channel, frame);
                    default -> reject(channel);
                }
            }
            default -> reject(channel);
        }
    }

    /** hello: 목적(measure·calibration)에 따라 확인하고 {@code ready}를 보낸다. */
    private void hello(Channel channel, WebSocketSession socket, JsonNode frame) {
        long started = System.nanoTime();
        String purpose = Json.text(frame.path("purpose"));
        boolean measure = "measure".equals(purpose);
        if (!"2.0".equals(Json.text(frame.path("schema_version"), null))
                || !(measure ? exactly(frame, HELLO_MEASURE) : "calibration".equals(purpose) && exactly(frame, HELLO_CALIBRATION))) {
            reject(channel);
            return;
        }
        UUID id = uuid(frame.path(measure ? "session_id" : "calibration_id"));
        if (id == null) {
            reject(channel);
            return;
        }
        try {
            channel.owner = current.id(tokens.authenticate(Json.text(frame.path("access_token"), null)));
            if (!measure) {
                channel.capture = new SessionService.Capture();
                channel.calibration = id;
                channel.state.set(State.CALIBRATION);
                send(channel, new RealtimeMessages.V2.ReadyCalibration(id));
                return;
            }
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
        channel.state.set(State.MEASURE);
        send(channel, new RealtimeMessages.V2.ReadyMeasure(id, channel.realtime.startedAt()));
    }

    /** 측정 구간 하나: 특징 계산·추론·판정. observation·decision·alert는 이벤트로, 끝나면 ack·progress. */
    private void measure(Channel channel, JsonNode frame) {
        var interval = interval(frame);
        if (interval == null || interval.phase() == FrameInterval.Phase.calibration) {
            reject(channel);
            return;
        }
        UUID id = channel.session;
        try {
            var status = sessions.frames(channel.owner, id, interval, channel.realtime.baseline());
            channel.lastSequence = status.lastSequence();
            send(channel, new RealtimeMessages.V2.Ack(status.lastSequence()));
            send(channel, new RealtimeMessages.V2.Progress(status.lastSequence(), status.summary(), status.pausedReason()));
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

    /** 측정 end: 최종 {@code decision(session_ended)}과 {@code closed(ended)}는 세션 이벤트로 보낸다. */
    private void endMeasure(Channel channel, JsonNode frame) {
        Long endMs = endMs(frame);
        if (endMs == null) {
            reject(channel);
            return;
        }
        end(channel, endMs);
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

    /** 등록 구간 하나: 판정 가능 프레임 수와 관절 합만 남긴다. */
    private void capture(Channel channel, JsonNode frame) {
        var interval = interval(frame);
        if (interval == null) {
            reject(channel);
            return;
        }
        try {
            channel.capture.add(interval);
        } catch (ApiError invalid) {
            reject(channel);
            return;
        }
        send(channel, new RealtimeMessages.V2.Ack(interval.sequence()));
    }

    /** 등록 end: {@code calibration_result} → {@code closed(ended)}. 실패하면 저장하지 않는다. */
    private void endCalibration(Channel channel, JsonNode frame) {
        if (endMs(frame) == null) {
            reject(channel);
            return;
        }
        SessionService.Calibration result;
        try {
            result = sessions.calibrate(channel.owner, channel.capture, true);
        } catch (ApiError refused) {
            finishClosed(channel, refusal(refused));
            return;
        }
        if (result.ok()) {
            var baseline = result.baseline();
            send(
                    channel,
                    new RealtimeMessages.V2.CalibrationOk(
                            channel.calibration,
                            baseline.id(),
                            baseline.registeredAt(),
                            baseline.landmarks(),
                            result.validFrames()));
        } else {
            send(
                    channel,
                    new RealtimeMessages.V2.CalibrationFailed(channel.calibration, result.validFrames(), result.reason()));
        }
        finishClosed(channel, "ended");
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
            channel.ended = true;
            // DB에 저장하는 종료 시각과 같은 식(started_at + total_ms). 저장은 이 이벤트 뒤에 일어난다.
            channel.endedAt = channel.realtime.startedAt().plusMillis(update.summary().totalMs());
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
        CALIBRATION,
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
        private volatile long lastSequence = -1;
        /** 세션이 끝났다는 이벤트를 받았다(연결이 닫혀도 다시 끝내지 않는다). */
        private volatile boolean ended;
        /** 이 연결에서 세션이 끝났을 때의 서버 종료 시각. closed에 싣는다(그 전에는 null). */
        private volatile Instant endedAt;
        /** 세션이 끝났을 때 보낼 closed 사유(시간 한도면 limit_reached). */
        private volatile String endReason = "ended";
        /** 등록: calibration_id와 수집 상태. */
        private volatile UUID calibration;
        private volatile SessionService.Capture capture;

        private Channel(WebSocketSession socket) {
            this.socket = socket;
        }
    }
}
