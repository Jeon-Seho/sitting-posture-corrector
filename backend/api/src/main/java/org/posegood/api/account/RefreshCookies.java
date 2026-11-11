package org.posegood.api.account;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletResponse;

/**
 * 계정 경로의 HttpOnly 쿠키(refresh 토큰, 소셜 로그인 대기)를 같은 속성으로 만든다.
 *
 * SameSite=Lax: Discord에서 돌아오는 최상위 이동(GET)에도 실린다. 경로는 브라우저 기준({@code posegood.auth.refresh-cookie-path}).
 */
@Component
public class RefreshCookies {
	private final AuthTokens tokens;
	private final boolean secure;
	private final String path;

	public RefreshCookies(
		AuthTokens tokens,
		@Value("${posegood.auth.refresh-cookie-secure}")
		boolean secure,
		@Value("${posegood.auth.refresh-cookie-path}")
		String path) {
		this.tokens = tokens;
		this.secure = secure;
		this.path = path;
	}

	/** refresh 토큰 쿠키를 준다. */
	public void set(HttpServletResponse response, String refreshToken) {
		add(response, AuthTokens.REFRESH_COOKIE, refreshToken, tokens.refreshLifetime());
	}

	/** refresh 토큰 쿠키를 지운다. */
	public void clear(HttpServletResponse response) {
		add(response, AuthTokens.REFRESH_COOKIE, "", Duration.ZERO);
	}

	/** 같은 속성의 다른 쿠키(소셜 대기 등). {@code maxAge}가 0이면 지운다. */
	public void add(HttpServletResponse response, String name, String value, Duration maxAge) {
		response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(name, value)
			.httpOnly(true)
			.secure(secure)
			.sameSite("Lax")
			.path(path)
			.maxAge(maxAge)
			.build()
			.toString());
	}
}
