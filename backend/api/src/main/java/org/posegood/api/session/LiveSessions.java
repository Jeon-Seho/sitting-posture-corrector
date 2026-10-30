package org.posegood.api.session;

import java.time.Duration;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.posegood.api.account.AccountService;
import org.posegood.api.common.ApiError;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 메모리에 있는 진행 중 세션 목록(최대 512개). API를 재시작하면 사라진다.
 *
 * V2.2에는 관측·스냅샷 테이블이 없어 재시작하면 진행 중 세션은 404 SESSION_LOST가 된다.
 * 끝난 세션도 앱이 기록을 정확한 상태와 대조해 저장할 수 있게 잠시 남겨 둔다.
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
		@Value("${posegood.live-session-capacity}")
		int capacity,
		@Value("${posegood.ended-session-retention}")
		Duration endedRetention,
		@Value("${posegood.idle-session-retention}")
		Duration idleRetention) {
		this.events = events;
		this.capacity = capacity;
		this.endedRetentionNanos = endedRetention.toNanos();
		this.idleRetentionNanos = idleRetention.toNanos();
	}

	/** 세션 상태 조회(없으면 null). */
	public LiveSession get(UUID id) {
		return sessions.get(id);
	}

	/**
	 * 자리가 없으면 가장 오래 쉰 종료 세션부터 뺀다.
	 *
	 * 모두 진행 중이면 거절한다(429).
	 */
	void ensureRoom() {
		while (sessions.size() >= capacity) {
			var oldest = sessions.values().stream()
				.filter(candidate -> candidate.engine().ended())
				.max(Comparator.comparingLong(LiveSession::idleNanos));
			if (oldest.isEmpty()) {
				throw ApiError.limit("live session capacity reached");
			}
			remove(oldest.get().id(), "session_lost");
		}
	}

	void add(LiveSession session) {
		sessions.put(session.id(), session);
	}

	/**
	 * 세션을 메모리에서 빼고 실시간 채널에 알린다.
	 *
	 * 실시간 채널은 {@code reason}으로 닫힌다.
	 */
	public void remove(UUID id, String reason) {
		if (sessions.remove(id) != null) {
			events.publishEvent(new SessionUpdates.Removed(id, reason));
		}
	}

	/** 탈퇴한 계정의 세션을 메모리에서 뺀다. */
	@EventListener
	public void accountClosed(AccountService.AccountClosed closed) {
		sessions.values().stream()
			.filter(session -> session.owner() == closed.userId())
			.map(LiveSession::id)
			.toList()
			.forEach(id -> remove(id, "unauthorized"));
	}

	/**
	 * 1분마다: 종료 후 30분, 방치 6시간이 지난 세션을 정리한다.
	 */
	@Scheduled(fixedDelay = 60_000)
	public void evict() {
		for (var session : sessions.values()) {
			long limit = session.engine().ended() ? endedRetentionNanos : idleRetentionNanos;
			if (session.idleNanos() > limit) {
				remove(session.id(), "session_lost");
			}
		}
	}
}
