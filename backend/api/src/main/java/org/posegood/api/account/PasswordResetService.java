package org.posegood.api.account;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import jakarta.annotation.PreDestroy;

/**
 * 비밀번호 재설정(일회용 링크). 비밀번호를 메일로 보내거나 임시 비밀번호를 만들지 않는다.
 *
 * <ul>
 * <li>요청: 가입 여부와 관계없이 같은 응답(202)을 바로 준다. 계정 확인·토큰 발급·메일 발송은 응답 뒤 별도 스레드에서 해
 * 응답 시간으로도 가입 여부가 드러나지 않게 한다. 출처별 제한({@link RequestLimiter})과 계정별 재발송 간격을 둔다.</li>
 * <li>토큰: 무작위 32바이트(base64url). DB에는 SHA-256만 두고, 새로 발급하면 이전 토큰은 무효다. 수명 30분(설정값).</li>
 * <li>완료: 토큰을 원자적으로 한 번만 소비하고 새 비밀번호(BCrypt)를 저장한 뒤 그 사용자의 모든 로그인을 끊는다
 * (refresh 토큰 철회 + 실시간 연결 닫기). 자동으로 로그인시키지 않는다.</li>
 * <li>비밀번호 변경·탈퇴·재설정으로 로그인이 끊기면({@link AccountService.LoginsRemoved}) 남은 재설정 토큰도 무효다.</li>
 * </ul>
 * {@code posegood.auth.password-reset.enabled=false}(기본)이면 경로는 404이고 표({@code password_reset_token})를 읽지 않는다.
 */
@Service
public class PasswordResetService {
	private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

	private final boolean enabled;
	private final PasswordResetRepository resets;
	private final AccountRepository accounts;
	private final AccountService accountService;
	private final RequestLimiter limiter;
	private final PasswordResetMailer mailer;
	private final UserLocks locks;
	private final TransactionTemplate tx;
	private final ApplicationEventPublisher events;
	private final String appUrl;
	private final Duration lifetime;
	private final Duration resendInterval;
	private final Clock clock;
	private final ExecutorService worker;

	@Autowired
	public PasswordResetService(
		@Value("${posegood.auth.password-reset.enabled:false}")
		boolean enabled,
		PasswordResetRepository resets,
		AccountRepository accounts,
		AccountService accountService,
		RequestLimiter limiter,
		PasswordResetMailer mailer,
		UserLocks locks,
		TransactionTemplate tx,
		ApplicationEventPublisher events,
		@Value("${posegood.auth.app-url:}")
		String appUrl,
		@Value("${posegood.auth.password-reset.lifetime:30m}")
		Duration lifetime,
		@Value("${posegood.auth.password-reset.resend-interval:60s}")
		Duration resendInterval) {
		this(new Settings(enabled, appUrl, lifetime, resendInterval), resets, accounts, accountService, limiter,
			mailer, locks, tx, events, Clock.systemUTC(),
			new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(200)));
	}

	/** 설정값 묶음(시험에서 직접 만든다). */
	record Settings(boolean enabled, String appUrl, Duration lifetime, Duration resendInterval) {
	}

	PasswordResetService(
		Settings settings, PasswordResetRepository resets, AccountRepository accounts, AccountService accountService,
		RequestLimiter limiter, PasswordResetMailer mailer, UserLocks locks, TransactionTemplate tx,
		ApplicationEventPublisher events, Clock clock, ExecutorService worker) {
		this.enabled = settings.enabled();
		this.resets = resets;
		this.accounts = accounts;
		this.accountService = accountService;
		this.limiter = limiter;
		this.mailer = mailer;
		this.locks = locks;
		this.tx = tx;
		this.events = events;
		this.appUrl = settings.appUrl().strip();
		this.lifetime = settings.lifetime();
		this.resendInterval = settings.resendInterval();
		this.clock = clock;
		this.worker = worker;
		if (enabled) {
			if (!this.appUrl.startsWith("http")) {
				throw new IllegalStateException("posegood.auth.app-url must be an absolute app URL for password reset");
			}
			mailer.requireReady();
		}
	}

	@PreDestroy
	void stop() {
		worker.shutdown();
	}

	/**
	 * 재설정 메일 요청. 형식이 맞으면 결과와 관계없이 바로 돌아간다(202). 출처 한도를 넘으면 429.
	 *
	 * @param client 요청 출처(IP). 제한에만 쓰고 저장하지 않는다.
	 */
	public void request(String email, String client) {
		requireEnabled();
		String normalized = AccountService.normalize(email);
		if (normalized.length() > 254 || !normalized.matches("[^@\\s]+@[^@\\s]+")) {
			throw ApiError.badRequest("email is invalid");
		}
		if (!limiter.allow(client)) {
			throw new ApiError(429, "RATE_LIMITED", "too many requests; retry later");
		}
		try {
			worker.execute(() -> issue(normalized));
		} catch (RejectedExecutionException busy) {
			// 대기열이 가득 참: 응답은 같게 두고 이번 요청은 버린다(사용자는 다시 요청할 수 있다).
			log.warn("password reset queue is full; one request dropped");
		}
	}

	/** 응답 뒤에 실행: 계정 확인 → 재발송 간격 → 토큰 발급 → 메일. 실패는 기록만 한다(주소·링크는 남기지 않는다). */
	void issue(String email) {
		try {
			var account = accounts.findEmail(email);
			if (account == null || !account.active()) {
				return;
			}
			Instant now = clock.instant();
			Instant last = resets.lastIssued(account.id());
			if (last != null && now.isBefore(last.plus(resendInterval))) {
				return;
			}
			String token = SocialPending.random();
			tx.executeWithoutResult(status -> {
				resets.consumeAll(account.id(), now);
				resets.insert(account.id(), hash(token), now, now.plus(lifetime));
			});
			String link = UriComponentsBuilder.fromUriString(appUrl)
				.fragment("password-reset?token=" + token)
				.build()
				.toUriString();
			mailer.sendReset(account.email(), link, lifetime.toMinutes());
		} catch (RuntimeException failed) {
			log.warn("password reset mail was not sent ({})", failed.getClass().getSimpleName());
		}
	}

	/**
	 * 재설정 완료. 토큰이 없거나 만료·사용됐거나 계정이 정상 상태가 아니면 410 {@code RESET_TOKEN_INVALID}(이유는 구분하지 않음).
	 */
	public void confirm(String token, String newPassword) {
		requireEnabled();
		AccountService.requireNewPassword(newPassword);
		var stored = resets.find(hash(token));
		if (stored == null || stored.consumedAt() != null || !clock.instant().isBefore(stored.expiresAt())) {
			throw invalid();
		}
		locks.run(stored.owner(), () -> {
			var account = accounts.find(stored.owner());
			if (account == null || !account.active()) {
				throw invalid();
			}
			tx.executeWithoutResult(status -> {
				Instant now = clock.instant();
				if (resets.consume(stored.id(), now) != 1) {
					throw invalid();
				}
				accountService.applyResetPassword(stored.owner(), newPassword);
				resets.consumeAll(stored.owner(), now);
			});
		});
		events.publishEvent(new AccountService.LoginsRemoved(stored.owner()));
	}

	/** 비밀번호 변경·탈퇴·재설정으로 로그인이 끊기면 남은 재설정 링크도 무효로 만든다. */
	@EventListener
	public void loginsRemoved(AccountService.LoginsRemoved removed) {
		if (enabled) {
			resets.consumeAll(removed.userId(), clock.instant());
		}
	}

	/** 매일 04:40(KST) 만료된 지 하루가 지난 행을 지운다. */
	@Scheduled(cron = "0 40 4 * * *", zone = "Asia/Seoul")
	public void purgeExpired() {
		if (enabled) {
			resets.purgeExpired(clock.instant().minus(Duration.ofDays(1)));
		}
	}

	public boolean enabled() {
		return enabled;
	}

	private void requireEnabled() {
		if (!enabled) {
			throw new ApiError(404, "PASSWORD_RESET_DISABLED", "password reset is not configured");
		}
	}

	static String hash(String token) {
		return Json.sha256(token.getBytes(StandardCharsets.UTF_8));
	}

	private static ApiError invalid() {
		return new ApiError(410, "RESET_TOKEN_INVALID", "reset link is invalid, expired or already used");
	}
}
