package org.posegood.api.account;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

/** 가입 코드 발송·확인. 브라우저에는 코드 대신 무작위 대기 ID를 HttpOnly 쿠키로 준다. */
@RestController
@RequestMapping("/auth/email-verification")
public class EmailVerificationController {
	static final String COOKIE = "posegood_email_verification";
	private final EmailVerificationService verification;
	private final RefreshCookies cookies;
	private final boolean trustForwardedFor;

	public EmailVerificationController(EmailVerificationService verification, RefreshCookies cookies,
		@Value("${posegood.trust-forwarded-for:false}") boolean trustForwardedFor) {
		this.verification = verification;
		this.cookies = cookies;
		this.trustForwardedFor = trustForwardedFor;
	}

	@PostMapping("/requests")
	public ResponseEntity<Void> request(
		@Valid @RequestBody AccountContracts.PasswordResetRequest body,
		HttpServletRequest request, HttpServletResponse response) {
		String id = verification.request(body.email(), client(request));
		cookies.add(response, COOKIE, id, EmailVerificationService.LIFETIME);
		return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
	}

	private String client(HttpServletRequest request) {
		if (trustForwardedFor) {
			String forwarded = request.getHeader("X-Forwarded-For");
			if (forwarded != null && !forwarded.isBlank()) {
				return forwarded.split(",")[0].strip();
			}
		}
		return request.getRemoteAddr();
	}

	@PostMapping("/confirm")
	public ResponseEntity<Void> confirm(
		@CookieValue(name = COOKIE, required = false) String id,
		@Valid @RequestBody AccountContracts.MailToken body) {
		verification.confirm(id, body.token());
		return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
	}
}
