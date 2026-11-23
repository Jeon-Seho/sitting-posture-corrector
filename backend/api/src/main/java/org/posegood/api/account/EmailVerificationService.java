package org.posegood.api.account;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.function.Supplier;

import org.posegood.api.common.ApiError;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 가입 전 이메일 소유 확인(6자리 코드).
 *
 * <ul>
 * <li>요청: 메일로 6자리 코드를 보내고, 브라우저에는 무작위 요청 번호를 준다(컨트롤러가 HttpOnly 쿠키로). 같은 이메일은
 * {@link #RESEND}마다 한 번, 출처별 제한({@link RequestLimiter})도 둔다. 요청은 <b>메일을 보내기 전에</b> 저장한다
 * ({@link EmailVerificationRepository#reserve} — 같은 이메일은 DB 잠금으로 줄 세움). 그래서 메일이 느려도 같은 이메일의 동시 요청은
 * 429다(PR #144 리뷰: 저장을 발송 뒤에 하던 때는 동시 요청이 모두 메일을 보냈다). 새 요청을 저장하면 같은 이메일의 이전 코드와 확인
 * 증명은 무효다. 발송에 실패하면 새 요청도 무효로 하고 503이다(재발송 간격에는 들어간다).</li>
 * <li>저장: {@code email_verification_token}(V2.8 migration 019)에 요청 번호와 「요청 번호:코드」의 SHA-256만 둔다. 서버를
 * 재시작하거나 배포해도 진행 중인 인증이 이어진다(계획 0096, 2026-11-23 결정).</li>
 * <li>확인: 같은 브라우저(요청 번호)에서 코드를 맞히면 확인 시각을 남긴다. 시도는 요청마다 {@link #MAX_ATTEMPTS}번이고,
 * 넘으면 맞는 코드도 받지 않는다.</li>
 * <li>가입: 확인한 이메일과 가입 이메일이 같을 때, 증명 소비와 계정 생성을 한 트랜잭션으로 한다. 가입이 실패하면 소비도 되돌려
 * 같은 증명으로 다시 시도할 수 있다.</li>
 * </ul>
 * 상태 변경은 모두 DB 조건부 UPDATE·DB 잠금이라 서버 잠금 없이 동시 요청 중 하나만 통과하고, 서버가 여러 대여도 맞다.
 * 만료된 지 하루가 지난 행은 매일 지운다.
 * {@code posegood.auth.email-verification.enabled=false}(기본)이면 경로는 404이고 가입은 인증 없이 된다(표를 읽지 않음).
 */
@Service
public class EmailVerificationService {
	static final Duration LIFETIME = Duration.ofMinutes(15);
	static final Duration RESEND = Duration.ofSeconds(60);
	static final int MAX_ATTEMPTS = 5;
	private static final SecureRandom RANDOM = new SecureRandom();
	private final boolean enabled;
	private final EmailVerificationRepository verifications;
	private final PasswordResetMailer mailer;
	private final RequestLimiter limiter;
	private final TransactionTemplate tx;
	private final Clock clock;

	@Autowired
	public EmailVerificationService(
		@Value("${posegood.auth.email-verification.enabled:false}")
		boolean enabled, EmailVerificationRepository verifications, PasswordResetMailer mailer,
		RequestLimiter limiter, TransactionTemplate tx) {
		this(enabled, verifications, mailer, limiter, tx, Clock.systemUTC());
	}

	EmailVerificationService(
		boolean enabled, EmailVerificationRepository verifications, PasswordResetMailer mailer,
		RequestLimiter limiter, TransactionTemplate tx, Clock clock) {
		this.enabled = enabled;
		this.verifications = verifications;
		this.mailer = mailer;
		this.limiter = limiter;
		this.tx = tx;
		this.clock = clock;
		if (enabled) {
			mailer.requireReady();
		}
	}

	/** 요청을 저장하고 코드 메일을 보낸 뒤 요청 번호를 돌려준다. 간격 안이거나 같은 이메일 요청이 몰리면 429, 발송 실패는 503. */
	public String request(String rawEmail, String client) {
		requireEnabled();
		String email = AccountService.normalize(rawEmail);
		if (email.length() > 254 || !email.matches("[^@\\s]+@[^@\\s]+")) {
			throw ApiError.badRequest("email is invalid");
		}
		Instant now = clock.instant();
		if (!limiter.allow("verify:" + client)) {
			throw new ApiError(429, "RATE_LIMITED", "retry later");
		}
		String id = SocialPending.random();
		String code = String.format(Locale.ROOT, "%06d", RANDOM.nextInt(1_000_000));
		// 재발송 간격 확인과 이전 코드·인증 증명 무효화, 새 요청 저장을 메일보다 먼저 한다.
		var reserved = verifications.reserve(email, hash(id), codeHash(id, code), now, now.plus(LIFETIME),
			now.minus(RESEND));
		if (reserved != EmailVerificationRepository.Reserve.RESERVED) {
			throw new ApiError(429, "RATE_LIMITED", "retry later");
		}
		try {
			mailer.sendVerification(email, code, LIFETIME.toMinutes());
		} catch (RuntimeException failed) {
			verifications.revoke(hash(id), clock.instant());
			throw new ApiError(503, "MAIL_UNAVAILABLE", "email could not be sent");
		}
		return id;
	}

	/** 같은 브라우저(요청 번호)에서 코드를 확인한다. 없거나·만료·확인됨·사용됨·시도 초과·틀린 코드는 모두 410. */
	public void confirm(String id, String code) {
		requireEnabled();
		var stored = find(id);
		Instant now = clock.instant();
		if (verifications.attempt(stored.id(), now, MAX_ATTEMPTS) != 1) {
			throw invalid();
		}
		if (!MessageDigest.isEqual(
			stored.codeHash().getBytes(StandardCharsets.US_ASCII),
			codeHash(id, code).getBytes(StandardCharsets.US_ASCII))) {
			throw invalid();
		}
		if (verifications.verify(stored.id(), now) != 1) {
			throw invalid();
		}
	}

	/** 인증한 주소와 최종 가입 주소를 대조하고, 가입 성공 때만 증명을 한 번 소비한다(같은 트랜잭션). */
	public <T> T register(String id, String email, Supplier<T> register) {
		if (!enabled) {
			return register.get();
		}
		var stored = find(id);
		if (!stored.email().equals(AccountService.normalize(email))) {
			throw invalid();
		}
		return tx.execute(status -> {
			if (verifications.consume(stored.id(), clock.instant()) != 1) {
				throw invalid();
			}
			return register.get();
		});
	}

	/** 매일 04:45(KST) 만료된 지 하루가 지난 행을 지운다(비밀번호 재설정 정리 04:40 뒤). */
	@Scheduled(cron = "0 45 4 * * *", zone = "Asia/Seoul")
	public void purgeExpired() {
		if (enabled) {
			verifications.purgeExpired(clock.instant().minus(Duration.ofDays(1)));
		}
	}

	private EmailVerificationRepository.Stored find(String id) {
		var stored = id == null ? null : verifications.find(hash(id));
		if (stored == null || !clock.instant().isBefore(stored.expiresAt())) {
			throw invalid();
		}
		return stored;
	}

	private void requireEnabled() {
		if (!enabled) {
			throw new ApiError(404, "EMAIL_VERIFICATION_DISABLED", "email verification is not configured");
		}
	}

	private static String hash(String id) {
		return PasswordResetService.hash(id);
	}

	/** 코드는 경우의 수가 적어 요청 번호와 묶어 해시한다(요청 번호 원문은 DB에 없다). */
	private static String codeHash(String id, String code) {
		return PasswordResetService.hash(id + ":" + code);
	}

	private static ApiError invalid() {
		return new ApiError(410, "EMAIL_VERIFICATION_REQUIRED", "verify the registration email again");
	}
}
