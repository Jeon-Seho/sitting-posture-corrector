package org.posegood.api.account;

import org.posegood.api.common.ApiError;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Serializes one account's mutations (baseline replacement, withdrawal, settings) inside this
 * process. The API runs as a single instance because live session state is in memory (ADR 0020).
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
        if (!acquired)
            throw new ApiError(
                    503, "ACCOUNT_BUSY", "another account operation is in progress; retry same request");
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
