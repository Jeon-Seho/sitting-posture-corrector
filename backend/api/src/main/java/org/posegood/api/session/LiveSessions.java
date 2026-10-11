package org.posegood.api.session;

import org.posegood.api.account.AccountService;
import org.posegood.api.common.ApiError;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registry of sessions whose decision state lives in this process. Schema V2.2 stores no
 * observations or snapshots, so a restart loses unfinished sessions; they answer 404 SESSION_LOST.
 * Ended sessions stay for a while so that the app can save its record against the exact state.
 */
@Component
public class LiveSessions {
    private final ConcurrentHashMap<UUID, LiveSession> sessions = new ConcurrentHashMap<>();
    private final ApplicationEventPublisher events;
    private final int capacity;
    private final long endedRetentionNanos;
    private final long idleRetentionNanos;

    public LiveSessions(
            ApplicationEventPublisher events,
            @Value("${posegood.live-session-capacity}") int capacity,
            @Value("${posegood.ended-session-retention}") Duration endedRetention,
            @Value("${posegood.idle-session-retention}") Duration idleRetention) {
        this.events = events;
        this.capacity = capacity;
        this.endedRetentionNanos = endedRetention.toNanos();
        this.idleRetentionNanos = idleRetention.toNanos();
    }

    public LiveSession get(UUID id) {
        return sessions.get(id);
    }

    /** Makes room by dropping the longest idle ended session; refuses when every slot is active. */
    void ensureRoom() {
        while (sessions.size() >= capacity) {
            var oldest =
                    sessions.values().stream()
                            .filter(candidate -> candidate.engine().ended())
                            .max(Comparator.comparingLong(LiveSession::idleNanos));
            if (oldest.isEmpty()) throw ApiError.limit("live session capacity reached");
            remove(oldest.get().id(), "session_lost");
        }
    }

    void add(LiveSession session) {
        sessions.put(session.id(), session);
    }

    /** Drops the live state; realtime channels are closed with {@code reason}. */
    public void remove(UUID id, String reason) {
        if (sessions.remove(id) != null) events.publishEvent(new SessionUpdates.Removed(id, reason));
    }

    @EventListener
    public void accountClosed(AccountService.AccountClosed closed) {
        sessions.values().stream()
                .filter(session -> session.owner() == closed.userId())
                .map(LiveSession::id)
                .toList()
                .forEach(id -> remove(id, "unauthorized"));
    }

    /** Ended sessions leave after their retention; unfinished ones after a long idle time. */
    @Scheduled(fixedDelay = 60_000)
    public void evict() {
        for (var session : sessions.values()) {
            long limit = session.engine().ended() ? endedRetentionNanos : idleRetentionNanos;
            if (session.idleNanos() > limit) remove(session.id(), "session_lost");
        }
    }
}
