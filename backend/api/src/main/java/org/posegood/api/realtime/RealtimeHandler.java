package org.posegood.api.realtime;

import com.fasterxml.jackson.databind.JsonNode;

import jakarta.validation.Validator;

import org.posegood.api.account.AccountPrincipal;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.CanonicalUuidDeserializer;
import org.posegood.api.common.Json;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.session.LiveSession;
import org.posegood.api.session.SessionService;
import org.posegood.api.session.SessionUpdates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * 실시간 채널: hello로 세션에 연결하고 features로 특징을 받아 판정 결과를 push한다.
 *
 * 계약: contracts/realtime(초안 v1), Kafka 없이 처리한다. 특징은 HTTP와 같은 {@link SessionService} 경로로 가고,
 * 관측·판정·알림·진행 상황은 그 세션에 연결된 모든 채널로 보낸다. 세션 생성·종료·복구는 HTTP로 한다.
 *
 * <p>추론·DB 일시 장애는 {@code stalled}를 보내고 연결을 닫는다. 앱은 다시 연결해 확인받지 못한 구간을
 * 다시 보낸다. 확실한 거절은 채널을 닫는다.
 */
@Component
public class RealtimeHandler extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(RealtimeHandler.class);
    private static final Set<String> HELLO = Set.of("type", "schema_version", "session_id", "last_event_id");
    private static final Set<String> FEATURES = Set.of("type", "session_id", "items");
    private static final int MAX_ITEMS = 30;

    private final SessionService sessions;
    private final CurrentUser current;
    private final Json json;
    private final Validator validator;
    private final ConcurrentHashMap<String, Channel> channels = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Set<Channel>> bySession = new ConcurrentHashMap<>();

    public RealtimeHandler(SessionService sessions, CurrentUser current, Json json, Validator validator) {
        this.sessions = sessions;
        this.current = current;
        this.json = json;
        this.validator = validator;
    }

    /** 새 연결 등록. */
    @Override
    public void afterConnectionEstablished(WebSocketSession socket) {
        channels.put(socket.getId(), new Channel(new ConcurrentWebSocketSessionDecorator(socket, 5000, 1 << 20)));
    }

    /** 연결이 끊기면 정리. */
    @Override
    public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
        var channel = channels.remove(socket.getId());
        if (channel != null && channel.session != null) unbind(channel);
    }

    /** 메시지 종류(hello·features)에 따라 처리. 그 밖은 연결을 닫는다. */
    @Override
    protected void handleTextMessage(WebSocketSession socket, TextMessage message) {
        var channel = channels.get(socket.getId());
        if (channel == null) return;
        JsonNode frame;
        try {
            frame = json.mapper().readTree(message.getPayload());
        } catch (IOException | RuntimeException unreadable) {
            close(channel, CloseStatus.NOT_ACCEPTABLE);
            return;
        }
        String type = frame.path("type").asText();
        switch (type) {
            case "hello" -> hello(channel, socket, frame);
            case "features" -> features(channel, socket, frame);
            default -> close(channel, CloseStatus.NOT_ACCEPTABLE);
        }
    }

    /**
     * hello: 내 세션에 연결하고 놓친 사건을 다시 보낸다.
     *
     * last_event_id 뒤의 사건을 보낸 다음 ack·progress를 보낸다.
     */
    private void hello(Channel channel, WebSocketSession socket, JsonNode frame) {
        UUID id = sessionId(frame);
        if (id == null
                || !exactly(frame, HELLO)
                || !"1.0".equals(frame.path("schema_version").asText(null))
                || !frame.path("last_event_id").canConvertToLong()
                || !frame.path("last_event_id").isIntegralNumber()
                || frame.path("last_event_id").asLong() < 0) {
            close(channel, CloseStatus.NOT_ACCEPTABLE);
            return;
        }
        if (channel.session != null && !channel.session.equals(id)) unbind(channel);
        long owner;
        LiveSession session;
        try {
            owner = owner(socket);
            session = sessions.require(owner, id);
        } catch (ApiError refused) {
            closed(channel, id, refusal(refused));
            return;
        }
        channel.owner = owner;
        long after = frame.path("last_event_id").asLong();
        session.locked(
                () -> {
                    channel.session = id;
                    bySession.computeIfAbsent(id, ignored -> new CopyOnWriteArraySet<>()).add(channel);
                    var engine = session.engine();
                    for (var decided : engine.eventsAfter(after))
                        send(channel, new RealtimeMessages.Decision(id, decided.event(), decided.summary()));
                    send(channel, new RealtimeMessages.Ack(id, engine.lastSequence()));
                    send(channel, new RealtimeMessages.Progress(id, engine.lastSequence(), engine.summary()));
                    if (engine.ended()) closed(channel, id, "ended");
                    return null;
                });
    }

    /** features: 1~30구간을 HTTP와 같은 경로로 처리하고 ack·progress를 보낸다. */
    private void features(Channel channel, WebSocketSession socket, JsonNode frame) {
        UUID id = sessionId(frame);
        if (channel.session == null || !channel.session.equals(id)) return; // hello가 먼저
        var items = frame.path("items");
        if (!exactly(frame, FEATURES) || !items.isArray() || items.isEmpty() || items.size() > MAX_ITEMS) {
            closed(channel, id, "session_lost");
            return;
        }
        var requests = new ArrayList<InferenceRequest>();
        for (var item : items) {
            try {
                var request = json.convert(item, InferenceRequest.class);
                if (!validator.validate(request).isEmpty()) throw ApiError.badRequest("invalid contract");
                requests.add(request);
            } catch (ApiError invalid) {
                closed(channel, id, "session_lost");
                return;
            }
        }
        LiveSession session;
        try {
            long owner = owner(socket);
            if (owner != channel.owner) throw new ApiError(401, "UNAUTHENTICATED", "account changed");
            for (var request : requests) sessions.features(owner, id, request);
            session = sessions.require(owner, id);
        } catch (ApiError refused) {
            if (refused.status() == 502 || refused.status() == 503) {
                retryLater(channel, id);
                return;
            }
            if ("SESSION_ENDED".equals(refused.code())) {
                closed(channel, id, "ended");
                return;
            }
            closed(channel, id, refusal(refused));
            return;
        } catch (org.springframework.dao.DataAccessException storage) {
            retryLater(channel, id);
            return;
        }
        session.locked(
                () -> {
                    SessionEngine engine = session.engine();
                    send(channel, new RealtimeMessages.Ack(id, engine.lastSequence()));
                    send(channel, new RealtimeMessages.Progress(id, engine.lastSequence(), engine.summary()));
                    return null;
                });
    }

    /**
     * 세션에 새 결과가 생기면 연결된 모든 채널에 보낸다.
     */
    @EventListener
    public void progressed(SessionUpdates.Progressed update) {
        var targets = bySession.get(update.sessionId());
        if (targets == null) return;
        for (var channel : targets) {
            if (update.observation() != null)
                send(channel, new RealtimeMessages.ObservationPush(update.sessionId(), update.observation()));
            for (var decided : update.decided()) {
                var event = decided.event();
                send(channel, new RealtimeMessages.Decision(update.sessionId(), event, decided.summary()));
                if ("collapse_confirmed".equals(event.kind()) || "reminder".equals(event.kind()))
                    send(channel, new RealtimeMessages.Alert(update.sessionId(), event));
            }
            if (update.ended()) {
                send(channel, new RealtimeMessages.Progress(update.sessionId(), update.lastSequence(), update.summary()));
                closed(channel, update.sessionId(), "ended");
            }
        }
    }

    /** 세션이 메모리에서 빠지면 연결된 채널을 닫는다. */
    @EventListener
    public void removed(SessionUpdates.Removed removed) {
        var targets = bySession.get(removed.sessionId());
        if (targets == null) return;
        for (var channel : targets) closed(channel, removed.sessionId(), removed.reason());
    }

    /**
     * 비밀번호 변경·탈퇴로 로그인이 지워지면 그 사용자의 연결을 닫는다.
     *
     * 연결은 처음 맺을 때의 로그인을 계속 쓰므로 그 로그인이 끝나면 함께 닫는다.
     */
    @EventListener
    public void loginsRemoved(AccountService.LoginsRemoved removed) {
        for (var channel : channels.values()) {
            if (!(channel.socket.getPrincipal() instanceof Authentication authentication)
                    || !(authentication.getPrincipal() instanceof AccountPrincipal principal)
                    || principal.id() != removed.userId()) continue;
            if (channel.session != null) closed(channel, channel.session, "unauthorized");
            else close(channel, CloseStatus.POLICY_VIOLATION);
        }
    }

    /** 서버 종료 때: 앱은 확인받지 못한 구간을 가지고 있다가 다시 연결한다. */
    @jakarta.annotation.PreDestroy
    public void shutdown() {
        for (var channel : channels.values())
            if (channel.session != null) closed(channel, channel.session, "server_shutdown");
    }

    private long owner(WebSocketSession socket) {
        if (!(socket.getPrincipal() instanceof Authentication authentication))
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        return current.id(authentication);
    }

    private static String refusal(ApiError refused) {
        if (refused.status() == 401) return "unauthorized";
        if (refused.status() == 404 && "SESSION_NOT_FOUND".equals(refused.code())) return "not_owner";
        return "session_lost";
    }

    private void retryLater(Channel channel, UUID id) {
        send(channel, new RealtimeMessages.Stalled(id, -1));
        close(channel, CloseStatus.SERVICE_RESTARTED);
    }

    private void closed(Channel channel, UUID id, String reason) {
        send(channel, new RealtimeMessages.Closed(id, reason));
        close(channel, CloseStatus.NORMAL);
    }

    private void unbind(Channel channel) {
        var set = bySession.get(channel.session);
        if (set != null) {
            set.remove(channel);
            if (set.isEmpty()) bySession.remove(channel.session, set);
        }
        channel.session = null;
    }

    private void send(Channel channel, Object message) {
        try {
            if (channel.socket.isOpen()) channel.socket.sendMessage(new TextMessage(json.write(message)));
        } catch (IOException | RuntimeException failed) {
            log.debug("realtime send failed: {}", failed.getClass().getSimpleName());
            close(channel, CloseStatus.SESSION_NOT_RELIABLE);
        }
    }

    private void close(Channel channel, CloseStatus status) {
        if (channel.session != null) unbind(channel);
        try {
            if (channel.socket.isOpen()) channel.socket.close(status);
        } catch (IOException ignored) {
            // 상대가 이미 닫았다.
        }
    }

    private static UUID sessionId(JsonNode frame) {
        var text = frame.path("session_id").asText(null);
        if (text == null || !CanonicalUuidDeserializer.CANONICAL.matcher(text).matches()) return null;
        return UUID.fromString(text);
    }

    private static boolean exactly(JsonNode frame, Set<String> keys) {
        if (frame.size() != keys.size()) return false;
        for (Iterator<String> names = frame.fieldNames(); names.hasNext(); )
            if (!keys.contains(names.next())) return false;
        return true;
    }

    /** 연결 하나. {@code session}은 hello 때 정해진다. */
    private static final class Channel {
        private final WebSocketSession socket;
        private volatile UUID session;
        private volatile long owner;

        private Channel(WebSocketSession socket) {
            this.socket = socket;
        }
    }
}
