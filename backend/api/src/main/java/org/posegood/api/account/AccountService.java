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

/**
 * 계정 규칙 처리: 가입, 비밀번호 변경, 탈퇴 접수·철회, 유예 후 일괄 삭제.
 *
 * 근거: contracts/accounts.v1.md, database/README.md 9장(스키마 V2.2).
 */
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

    /** 이메일 정규화(앞뒤 공백 제거, 소문자). */
    public static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    /**
     * 정상(ACTIVE) 계정만 통과. 없거나 탈퇴 중이면 401.
     */
    public AccountRepository.Account requireActive(long id) {
        var account = accounts.find(id);
        if (account == null || !account.active())
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        return account;
    }

    /** 가입: 비밀번호 규칙·동의 확인 후 기본 판정 정책으로 계정을 만든다. */
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

    /** 비밀번호 변경: 모든 로그인을 끊고 실시간 연결도 닫게 알린다. */
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
     * 탈퇴 접수: 계정을 CLOSED로 바꾸고 모든 로그인을 끊는다. 실제 삭제는 30일 뒤.
     *
     * 유예 기간에는 식별 정보와 기록을 그대로 둔다. 유예가 끝나면 {@link #purgeWithdrawn()}이 지운다.
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

    /**
     * 탈퇴 철회(유예 기간 안, 이메일·비밀번호로 확인).
     */
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
     * 매시간 실행: 유예가 끝난 탈퇴 계정을 계정마다 한 트랜잭션으로 지운다.
     *
     * 특징 적재 파일을 먼저 지워야 한다. HDFS 파일 삭제 기능이 생기기 전까지 그런 계정은 FAILED로 남는다.
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
                    // 다음 실행에서 같은 요청을 다시 처리한다.
                }
            }
        }
    }

    /** 현재 비밀번호 확인(틀리면 400). */
    public void requireCurrent(String password, String hash) {
        if (password.getBytes(StandardCharsets.UTF_8).length > 72 || !passwords.matches(password, hash))
            throw new ApiError(400, "INVALID_PASSWORD", "current password is incorrect");
    }

    /** 새 비밀번호 규칙: 12자 이상, UTF-8 72바이트 이하. */
    private static void requireNewPassword(String password) {
        if (password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiError(
                    400,
                    "INVALID_PASSWORD",
                    "password must have 12 or more characters and at most 72 UTF-8 bytes");
    }

    /**
     * 탈퇴 접수 알림: 진행 중 세션을 메모리에서 정리한다.
     */
    public record AccountClosed(long userId) {}

    /**
     * 로그인 삭제 알림: 열린 실시간(WebSocket) 연결을 닫는다.
     *
     * 그 로그인으로 열린 연결은 로그인 행이 지워진 뒤에도 남아 있으므로 따로 닫아야 한다.
     */
    public record LoginsRemoved(long userId) {}
}
