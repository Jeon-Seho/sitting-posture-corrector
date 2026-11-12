package org.posegood.api.account;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 요청 출처(IP)별 간단한 고정 창 제한(서버 메모리). API는 한 인스턴스로 돈다(ADR 0020).
 *
 * 비밀번호 재설정 메일 요청에 쓴다: 출처마다 {@link #WINDOW} 안에 {@link #LIMIT}번까지.
 */
@Component
public class RequestLimiter {
	static final int LIMIT = 5;
	static final Duration WINDOW = Duration.ofMinutes(15);
	private static final int CAPACITY = 50_000;

	private final ConcurrentHashMap<String, ArrayDeque<Instant>> hits = new ConcurrentHashMap<>();
	private final Clock clock;

	public RequestLimiter() {
		this(Clock.systemUTC());
	}

	RequestLimiter(Clock clock) {
		this.clock = clock;
	}

	/** 허용하면 기록하고 true. 한도를 넘으면 false. */
	public boolean allow(String key) {
		Instant now = clock.instant();
		if (hits.size() >= CAPACITY) {
			purge();
		}
		var queue = hits.computeIfAbsent(key, ignored -> new ArrayDeque<>());
		synchronized (queue) {
			while (!queue.isEmpty() && !queue.peekFirst().isAfter(now.minus(WINDOW))) {
				queue.pollFirst();
			}
			if (queue.size() >= LIMIT) {
				return false;
			}
			queue.addLast(now);
			return true;
		}
	}

	/** 창이 지난 출처를 정리한다(10분마다). */
	@Scheduled(fixedDelay = 600_000)
	public void purge() {
		Instant edge = clock.instant().minus(WINDOW);
		hits.entrySet().removeIf(entry -> {
			synchronized (entry.getValue()) {
				return entry.getValue().isEmpty() || !entry.getValue().peekLast().isAfter(edge);
			}
		});
	}
}
