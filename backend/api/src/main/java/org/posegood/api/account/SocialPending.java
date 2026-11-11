package org.posegood.api.account;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 소셜 로그인 중간 상태(서버 메모리, 짧은 수명). 브라우저에는 무작위 ID만 HttpOnly 쿠키로 준다.
 *
 * <ul>
 * <li>{@link Authorization}: 제공자로 보내기 전에 만든 제공자·state·PKCE verifier·연결할 사용자. 10분.</li>
 * <li>{@link Signup}: 연결된 계정이 없는 제공자 사용자의 가입 대기(제공자·사용자 ID·확인된 이메일). 15분.</li>
 * </ul>
 * 한 번 꺼내면 지운다(재사용 불가). API는 한 인스턴스로 돌므로(ADR 0020) 메모리로 충분하고, 재시작하면 처음부터 다시 한다.
 */
@Component
public class SocialPending {
	static final Duration AUTHORIZATION_LIFETIME = Duration.ofMinutes(10);
	static final Duration SIGNUP_LIFETIME = Duration.ofMinutes(15);
	private static final int CAPACITY = 10_000;
	private static final SecureRandom RANDOM = new SecureRandom();

	private final ConcurrentHashMap<String, Entry<Authorization>> authorizations = new ConcurrentHashMap<>();
	private final ConcurrentHashMap<String, Entry<Signup>> signups = new ConcurrentHashMap<>();
	private final Clock clock;

	public SocialPending() {
		this(Clock.systemUTC());
	}

	SocialPending(Clock clock) {
		this.clock = clock;
	}

	/** 제공자로 보내기 전 상태. {@code provider}는 주소 ID(discord …), {@code linkUser}는 연결일 때 로그인한 사용자, 로그인일 때 null. */
	public record Authorization(String provider, String state, String codeVerifier, Long linkUser) {
	}

	/** 가입 대기. {@code subject}는 제공자 사용자 ID, {@code email}은 제공자가 확인한 주소다. */
	public record Signup(String provider, String subject, String email, String suggestedName) {
	}

	private record Entry<T>(T value, Instant expiresAt) {
	}

	/** 새 무작위 값(32바이트, base64url). state·verifier·쿠키 ID에 쓴다. */
	public static String random() {
		var bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	public String putAuthorization(Authorization value) {
		return put(authorizations, value, AUTHORIZATION_LIFETIME);
	}

	/** 꺼내고 지운다. 없거나 만료면 null. */
	public Authorization takeAuthorization(String id) {
		return take(authorizations, id);
	}

	public String putSignup(Signup value) {
		return put(signups, value, SIGNUP_LIFETIME);
	}

	/** 지우지 않고 본다(가입 화면의 제안값). 없거나 만료면 null. */
	public Signup peekSignup(String id) {
		if (id == null) {
			return null;
		}
		var entry = signups.get(id);
		return entry == null || !clock.instant().isBefore(entry.expiresAt()) ? null : entry.value();
	}

	/** 꺼내고 지운다. 없거나 만료면 null. */
	public Signup takeSignup(String id) {
		return take(signups, id);
	}

	/** 만료된 항목 정리(5분마다). */
	@Scheduled(fixedDelay = 300_000)
	public void purge() {
		Instant now = clock.instant();
		authorizations.values().removeIf(entry -> !now.isBefore(entry.expiresAt()));
		signups.values().removeIf(entry -> !now.isBefore(entry.expiresAt()));
	}

	private <T> String put(ConcurrentHashMap<String, Entry<T>> map, T value, Duration lifetime) {
		if (map.size() >= CAPACITY) {
			purge();
			if (map.size() >= CAPACITY) {
				throw new org.posegood.api.common.ApiError(
					503, "SOCIAL_BUSY", "too many social logins in progress; retry later");
			}
		}
		String id = random();
		map.put(id, new Entry<>(value, clock.instant().plus(lifetime)));
		return id;
	}

	private <T> T take(ConcurrentHashMap<String, Entry<T>> map, String id) {
		if (id == null || id.isBlank()) {
			return null;
		}
		var entry = map.remove(id);
		return entry == null || !clock.instant().isBefore(entry.expiresAt()) ? null : entry.value();
	}
}
