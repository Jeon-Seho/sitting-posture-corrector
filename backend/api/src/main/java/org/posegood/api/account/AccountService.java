package org.posegood.api.account;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Account rules of contracts/accounts.v1.md on schema V2.2 (database/README.md section 9). */
@Service
public class AccountService {
    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final AccountRepository accounts;
    private final ThresholdPolicyRepository policies;
    private final PasswordEncoder passwords;
    private final UserLocks locks;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;
    private final int graceDays;

    public AccountService(
            AccountRepository accounts,
            ThresholdPolicyRepository policies,
            PasswordEncoder passwords,
            UserLocks locks,
            TransactionTemplate tx,
            ApplicationEventPublisher events,
            @Value("${posegood.withdrawal-grace-days}") int graceDays) {
        this.accounts = accounts;
        this.policies = policies;
        this.passwords = passwords;
        this.locks = locks;
        this.tx = tx;
        this.events = events;
        this.graceDays = graceDays;
    }

    public static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    /** Only ACTIVE accounts are signed in; a CLOSED one is 401 like a missing account. */
    public AccountRepository.Account requireActive(long id) {
        var account = accounts.find(id);
        if (account == null || !account.active())
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        return account;
    }

    public AccountRepository.Account register(AccountContracts.Register body) {
        requireNewPassword(body.password());
        if (!"service-v1".equals(body.consentVersion()))
            throw new ApiError(400, "CONSENT_REQUIRED", "service storage consent required");
        long id =
                tx.execute(
                        status ->
                                accounts.insert(
                                        normalize(body.email()),
                                        passwords.encode(body.password()),
                                        body.profile(),
                                        policies.defaultId()));
        return requireActive(id);
    }

    public void changePassword(long id, AccountContracts.PasswordChange body) {
        requireNewPassword(body.newPassword());
        locks.run(
                id,
                () -> {
                    var account = requireActive(id);
                    requireCurrent(body.currentPassword(), account.hash());
                    tx.executeWithoutResult(
                            status -> {
                                accounts.changePassword(id, passwords.encode(body.newPassword()));
                                accounts.removeLogins(id);
                            });
                });
        events.publishEvent(new LoginsRemoved(id));
    }

    /**
     * Withdrawal intake: CLOSED for the grace period with identity and records kept, every login
     * revoked. The account is deleted by {@link #purgeWithdrawn()} after the grace period.
     */
    public void withdraw(long id, AccountContracts.Withdrawal body) {
        locks.run(
                id,
                () -> {
                    var account = requireActive(id);
                    requireCurrent(body.password(), account.hash());
                    tx.executeWithoutResult(
                            status -> {
                                accounts.close(id, KstTime.now());
                                accounts.removeLogins(id);
                            });
                });
        events.publishEvent(new LoginsRemoved(id));
        events.publishEvent(new AccountClosed(id));
    }

    /** Withdrawal cancel during the grace period, authenticated by email and password. */
    public AccountRepository.Account cancelWithdrawal(AccountContracts.Login body) {
        var account = accounts.findEmail(normalize(body.email()));
        if (account == null
                || body.password().getBytes(StandardCharsets.UTF_8).length > 72
                || !passwords.matches(body.password(), account.hash()))
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        if (account.active()) return account;
        boolean reopened =
                locks.withLock(account.id(), () -> tx.execute(status -> accounts.reopen(account.id())));
        if (!reopened)
            throw new ApiError(409, "WITHDRAWAL_NOT_CANCELLABLE", "withdrawal is already processing");
        return requireActive(account.id());
    }

    /**
     * Final deletion after the grace period, one account per transaction (DB-04 6-1). Archived
     * feature files must be removed first; until an HDFS deleter exists such accounts stay FAILED.
     */
    @Scheduled(
            initialDelayString = "${posegood.withdrawal-purge-initial-ms}",
            fixedDelayString = "${posegood.withdrawal-purge-interval-ms}")
    public void purgeWithdrawn() {
        for (long id : accounts.withdrawalsDue(KstTime.now(), graceDays)) {
            try {
                locks.run(
                        id,
                        () -> {
                            if (accounts.pendingArchiveFiles(id) > 0) {
                                accounts.markWithdrawalFailed(id, "feature archive files not deleted");
                                return;
                            }
                            tx.executeWithoutResult(status -> accounts.deleteWithdrawn(id));
                        });
            } catch (RuntimeException failure) {
                log.warn("withdrawal purge failed for one account: {}", failure.getClass().getSimpleName());
                try {
                    accounts.markWithdrawalFailed(id, "deletion transaction failed");
                } catch (RuntimeException ignored) {
                    // The next run retries the same request.
                }
            }
        }
    }

    public void requireCurrent(String password, String hash) {
        if (password.getBytes(StandardCharsets.UTF_8).length > 72 || !passwords.matches(password, hash))
            throw new ApiError(400, "INVALID_PASSWORD", "current password is incorrect");
    }

    private static void requireNewPassword(String password) {
        if (password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiError(
                    400,
                    "INVALID_PASSWORD",
                    "password must have 12 or more characters and at most 72 UTF-8 bytes");
    }

    /** Published after a withdrawal so that live sessions of the account are dropped. */
    public record AccountClosed(long userId) {}

    /**
     * Published after every `SPRING_SESSION` row of the account was deleted (password change,
     * withdrawal), so that open realtime sockets authenticated by those logins are closed.
     */
    public record LoginsRemoved(long userId) {}
}
