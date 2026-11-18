package org.posegood.api.account;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import org.posegood.api.common.ApiError;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** 가입 전 이메일 소유 확인. 단일 API의 단기 대기는 메모리에, 코드 해시만 보관한다. */
@Service
public class EmailVerificationService {
	static final Duration LIFETIME = Duration.ofMinutes(15);
	private static final SecureRandom RANDOM = new SecureRandom();
	private final ConcurrentHashMap<String, Challenge> challenges = new ConcurrentHashMap<>();
	private final ConcurrentHashMap<String, Instant> lastSent = new ConcurrentHashMap<>();
	private final boolean enabled;
	private final PasswordResetMailer mailer;
	private final RequestLimiter limiter;
	private final Clock clock;

	private static final class Challenge {
		final String email;
		final String hash;
		final Instant expires;
		int attempts;
		boolean verified;
		boolean consumed;

		Challenge(String email, String hash, Instant expires) {
			this.email = email;
			this.hash = hash;
			this.expires = expires;
		}
	}

	@Autowired
	public EmailVerificationService(
		@Value("${posegood.auth.email-verification.enabled:false}")
		boolean enabled, PasswordResetMailer mailer, RequestLimiter limiter) {
		this(enabled, mailer, limiter, Clock.systemUTC());
	}

	EmailVerificationService(boolean enabled, PasswordResetMailer mailer, RequestLimiter limiter, Clock clock) {
		this.enabled = enabled;
		this.mailer = mailer;
		this.limiter = limiter;
		this.clock = clock;
		if (enabled) {
			mailer.requireReady();
		}
	}

	/** 발송 API(SMTP)가 요청을 수락했을 때만 대기를 만든다. 실패를 성공으로 표시하지 않는다. */
	public synchronized String request(String rawEmail, String client) {
		requireEnabled();
		String email = AccountService.normalize(rawEmail);
		if (email.length() > 254 || !email.matches("[^@\\s]+@[^@\\s]+")) {
			throw ApiError.badRequest("email is invalid");
		}
		Instant now = clock.instant();
		if (!limiter.allow("verify:" + client)
			|| (lastSent.containsKey(email) && now.isBefore(lastSent.get(email).plusSeconds(60)))) {
			throw new ApiError(429, "RATE_LIMITED", "retry later");
		}
		purge();
		if (challenges.size() >= 10_000 || lastSent.size() >= 10_000) {
			throw new ApiError(503, "EMAIL_BUSY", "retry later");
		}
		String id = SocialPending.random();
		String code = String.format(java.util.Locale.ROOT, "%06d", RANDOM.nextInt(1_000_000));
		lastSent.put(email, now);
		try {
			mailer.sendVerification(email, code, LIFETIME.toMinutes());
		} catch (RuntimeException failed) {
			throw new ApiError(503, "MAIL_UNAVAILABLE", "email could not be sent");
		}
		// 재발송하면 같은 주소의 이전 코드·인증 증명도 만료시킨다.
		challenges.entrySet().removeIf(entry -> entry.getValue().email.equals(email));
		challenges.put(id,
			new Challenge(email, PasswordResetService.hash(id + ":" + code), now.plus(LIFETIME)));
		return id;
	}

	public synchronized void confirm(String id, String code) {
		requireEnabled();
		Challenge challenge = require(id);
		synchronized (challenge) {
			if (challenge.consumed || challenge.attempts >= 5 || challenge.verified) {
				throw invalid();
			}
			challenge.attempts++;
			if (!java.security.MessageDigest.isEqual(
				challenge.hash.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
				PasswordResetService.hash(id + ":" + code).getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
				throw invalid();
			}
			challenge.verified = true;
		}
	}

	/** 인증한 주소와 최종 가입 주소를 대조하고, 가입 성공 때만 증명을 한 번 소비한다. */
	public synchronized <T> T register(String id, String email, Supplier<T> register) {
		if (!enabled) {
			return register.get();
		}
		Challenge challenge = require(id);
		synchronized (challenge) {
			if (challenge.consumed || !challenge.verified || !challenge.email.equals(AccountService.normalize(email))) {
				throw invalid();
			}
			T result = register.get();
			challenge.consumed = true;
			challenges.remove(id, challenge);
			return result;
		}
	}

	private Challenge require(String id) {
		Challenge value = id == null ? null : challenges.get(id);
		if (value == null || !clock.instant().isBefore(value.expires)) {
			throw invalid();
		}
		return value;
	}

	@Scheduled(fixedDelay = 60_000)
	public void purge() {
		Instant now = clock.instant();
		challenges.values().removeIf(value -> !now.isBefore(value.expires));
		lastSent.values().removeIf(value -> !now.isBefore(value.plus(LIFETIME)));
	}

	private void requireEnabled() {
		if (!enabled) {
			throw new ApiError(404, "EMAIL_VERIFICATION_DISABLED", "email verification is not configured");
		}
	}

	private static ApiError invalid() {
		return new ApiError(410, "EMAIL_VERIFICATION_REQUIRED", "verify the registration email again");
	}
}
