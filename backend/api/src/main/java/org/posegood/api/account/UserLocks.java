package org.posegood.api.account;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

import org.posegood.api.common.ApiError;
import org.springframework.stereotype.Component;

/**
 * 같은 사용자의 계정 작업을 한 번에 하나씩 실행하는 잠금(2초 안에 못 잡으면 503).
 *
 * 이 프로세스 안에서만 잠근다. 진행 중 세션 상태가 메모리에 있어 API는 한 인스턴스로 실행한다(ADR 0020).
 */
@Component
public class UserLocks {
	private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();

	public <T> T withLock(long user, Supplier<T> work) {
		var lock = locks.computeIfAbsent(user, ignored -> new ReentrantLock());
		boolean acquired;
		try {
			acquired = lock.tryLock(2, TimeUnit.SECONDS);
		} catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
			acquired = false;
		}
		if (!acquired) {
			throw new ApiError(
				503, "ACCOUNT_BUSY", "another account operation is in progress; retry same request");
		}
		try {
			return work.get();
		} finally {
			lock.unlock();
		}
	}

	public void run(long user, Runnable work) {
		withLock(
			user,
			() -> {
				work.run();
				return null;
			});
	}
}
