package org.posegood.api.application;

import org.posegood.api.account.UserStore;
import org.posegood.api.persistence.JdbcSessionStore;
import org.posegood.api.persistence.UserLocks;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** Retry only durable original outputs. Feature values cannot be re-inferred by this worker. */
@Configuration
@Profile("persistent")
@EnableScheduling
@ConditionalOnProperty(
        name = "posegood.recovery-enabled",
        havingValue = "true",
        matchIfMissing = true)
public class PersistentRecoveryWorker {
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(PersistentRecoveryWorker.class);
    private final JdbcSessionStore store;
    private final PersistentCepCoordinator delivery;
    private final UserLocks locks;
    private final UserStore users;

    public PersistentRecoveryWorker(
            JdbcSessionStore store,
            PersistentCepCoordinator delivery,
            UserLocks locks,
            UserStore users) {
        this.store = store;
        this.delivery = delivery;
        this.locks = locks;
        this.users = users;
    }

    @Scheduled(fixedDelayString = "${posegood.recovery-delay-ms:1000}")
    public void recover() {
        int deliveryFailures = 0;
        int cleanupFailures = 0;
        try {
            for (var id : store.recoveryCandidates()) {
                try {
                    store.markRecoveryAttempt(id);
                    var session = store.find(id);
                    if (session == null) continue;
                    locks.withLock(
                            session.owner(),
                            () -> {
                                users.require(session.owner());
                                var fresh = store.find(id);
                                if (fresh == null) return null;
                                // An unacknowledged end is not durable in V1.1; the client retries it.
                                if (store.pending(id) != null) delivery.deliver(fresh);
                                return null;
                            });
                } catch (RuntimeException unavailable) {
                    deliveryFailures++;
                }
            }
            for (var id : store.cleanupCandidates()) {
                try {
                    store.markCleanupAttempt(id);
                    delivery.cleanup(id);
                } catch (RuntimeException unavailable) {
                    cleanupFailures++;
                }
            }
        } catch (RuntimeException storageUnavailable) {
            LOG.warn("Durable recovery storage scan unavailable; saved work remains pending");
            return;
        }
        if (deliveryFailures > 0 || cleanupFailures > 0)
            LOG.warn(
                    "Durable recovery deferred: {} delivery failures, {} cleanup failures",
                    deliveryFailures,
                    cleanupFailures);
    }
}
