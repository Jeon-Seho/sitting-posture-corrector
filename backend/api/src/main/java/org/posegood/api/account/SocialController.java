package org.posegood.api.account;

import java.net.URI;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

/**
 * /v2/auth/social/* 소셜 로그인 공통 경로. {@code {provider}}는 discord·kakao·google·github 중 켜진 것(지금은 discord).
 *
 * <ol>
 * <li>앱이 {@code POST .../{provider}/login}(또는 로그인한 상태로 {@code .../{provider}/link})을 부르면 서버가 대기 ID를
 * HttpOnly 쿠키로 주고 제공자 동의 화면 주소를 돌려준다. 앱은 그 주소로 이동한다.</li>
 * <li>제공자가 {@code GET .../{provider}/callback}으로 돌려보내면 서버가 state를 확인하고 결과에 따라 refresh 쿠키를 주거나
 * 가입 대기 쿠키를 준 뒤 앱 주소({@code posegood.auth.app-url})의 {@code #social-result?status=}로 보낸다.
 * 주소에는 토큰을 싣지 않는다 — 앱은 기존처럼 {@code POST /v2/auth/refresh}로 access 토큰을 받는다.</li>
 * <li>가입이 필요하면 앱이 {@code GET .../signup}으로 제안값을 읽고 약관·프로필을 받아 {@code POST .../signup}을 부른다.</li>
 * </ol>
 */
@RestController
@RequestMapping("/v2/auth/social")
public class SocialController {
	static final String PENDING_COOKIE = "posegood_social";
	static final String SIGNUP_COOKIE = "posegood_social_signup";

	private final SocialLoginService social;
	private final AuthTokens tokens;
	private final CurrentUser current;
	private final RefreshCookies cookies;
	private final String appUrl;

	public SocialController(
		SocialLoginService social,
		AuthTokens tokens,
		CurrentUser current,
		RefreshCookies cookies,
		@Value("${posegood.auth.app-url:}")
		String appUrl) {
		this.social = social;
		this.tokens = tokens;
		this.current = current;
		this.cookies = cookies;
		this.appUrl = appUrl.strip();
		if (social.enabled() && !this.appUrl.startsWith("http")) {
			throw new IllegalStateException("posegood.auth.app-url must be an absolute app URL");
		}
	}

	/** 로그인(또는 가입) 시작. 로그인 없이 부른다. */
	@PostMapping("/{provider}/login")
	public AccountContracts.SocialStarted login(
		@PathVariable
		String provider,
		HttpServletResponse response) {
		return started(social.startLogin(provider), response);
	}

	/** 로그인한 사용자의 제공자 연결 시작. */
	@PostMapping("/{provider}/link")
	public AccountContracts.SocialStarted link(
		@PathVariable
		String provider,
		HttpServletResponse response) {
		return started(social.startLink(provider, current.id()), response);
	}

	/** 제공자가 돌려보내는 주소. 결과와 관계없이 앱으로 302 이동한다. */
	@GetMapping("/{provider}/callback")
	public ResponseEntity<Void> callback(
		@PathVariable
		String provider,
		@CookieValue(name = PENDING_COOKIE, required = false)
		String pendingId,
		@RequestParam(required = false)
		String state,
		@RequestParam(required = false)
		String code,
		@RequestParam(required = false)
		String error,
		HttpServletResponse response) {
		cookies.add(response, PENDING_COOKIE, "", Duration.ZERO);
		var outcome = social.callback(provider, pendingId, state, code, error);
		if (outcome.signedIn() != null) {
			cookies.set(response, tokens.signIn(outcome.signedIn()).refreshToken());
		}
		String fragment = "social-result?status=" + outcome.status();
		if (outcome.signupId() != null) {
			cookies.add(response, SIGNUP_COOKIE, outcome.signupId(), SocialPending.SIGNUP_LIFETIME);
			fragment = "social-signup";
		}
		URI target = UriComponentsBuilder.fromUriString(appUrl).fragment(fragment).build().toUri();
		return ResponseEntity.status(HttpStatus.FOUND)
			.header(HttpHeaders.LOCATION, target.toString())
			.header(HttpHeaders.CACHE_CONTROL, "no-store")
			.header("Referrer-Policy", "no-referrer")
			.build();
	}

	/** 가입 대기의 제안값(확인된 이메일·이름). */
	@GetMapping("/signup")
	public AccountContracts.SocialSignupDraft signupDraft(
		@CookieValue(name = SIGNUP_COOKIE, required = false)
		String signupId) {
		var draft = social.signupDraft(signupId);
		return new AccountContracts.SocialSignupDraft(draft.provider(), draft.email(), draft.suggestedName());
	}

	/** 가입 완료: 계정을 만들고 바로 로그인한다(일반 가입과 같은 응답). */
	@PostMapping("/signup")
	public AccountContracts.SignedIn signup(
		@CookieValue(name = SIGNUP_COOKIE, required = false)
		String signupId,
		@Valid
		@RequestBody
		AccountContracts.SocialSignup body,
		HttpServletResponse response) {
		var account = social.signup(signupId, body.profile(), body.consents());
		cookies.add(response, SIGNUP_COOKIE, "", Duration.ZERO);
		var issued = tokens.signIn(account.id());
		cookies.set(response, issued.refreshToken());
		return AccountContracts.SignedIn.of(account.view(), issued);
	}

	/** 내 로그인 수단. */
	@GetMapping
	public AccountContracts.SocialStatus status() {
		return social.status(current.id());
	}

	/** 제공자 연결 해제. */
	@DeleteMapping("/{provider}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void unlink(
		@PathVariable
		String provider) {
		social.unlink(provider, current.id());
	}

	private AccountContracts.SocialStarted started(SocialLoginService.Started started, HttpServletResponse response) {
		cookies.add(response, PENDING_COOKIE, started.pendingId(), SocialPending.AUTHORIZATION_LIFETIME);
		response.addHeader(HttpHeaders.CACHE_CONTROL, "no-store");
		return new AccountContracts.SocialStarted(started.authorizeUrl().toString());
	}
}
