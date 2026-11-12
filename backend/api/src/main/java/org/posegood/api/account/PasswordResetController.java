package org.posegood.api.account;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

/**
 * /auth/password-reset/* 비밀번호 재설정(로그인 없이 부름). 규칙은 {@link PasswordResetService}.
 *
 * <ul>
 * <li>{@code POST /requests} {@code {email}} → 202(가입 여부와 관계없이 같음), 429 출처 한도.</li>
 * <li>{@code POST /confirm} {@code {token,new_password}} → 204, 400 비밀번호 규칙, 410 링크 무효·만료·사용됨.</li>
 * </ul>
 */
@RestController
@RequestMapping("/auth/password-reset")
public class PasswordResetController {
	private final PasswordResetService resets;
	private final boolean trustForwardedFor;

	public PasswordResetController(
		PasswordResetService resets,
		@Value("${posegood.trust-forwarded-for:false}")
		boolean trustForwardedFor) {
		this.resets = resets;
		this.trustForwardedFor = trustForwardedFor;
	}

	@PostMapping("/requests")
	public ResponseEntity<Void> request(
		@Valid
		@RequestBody
		AccountContracts.PasswordResetRequest body, HttpServletRequest request) {
		resets.request(body.email(), client(request));
		return ResponseEntity.status(HttpStatus.ACCEPTED).cacheControl(CacheControl.noStore()).build();
	}

	@PostMapping("/confirm")
	public ResponseEntity<Void> confirm(
		@Valid
		@RequestBody
		AccountContracts.PasswordResetConfirm body) {
		resets.confirm(body.token(), body.newPassword());
		return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
	}

	/**
	 * 요청 출처. nginx가 {@code X-Forwarded-For}를 한 값으로 덮어쓰는 배포에서만 {@code posegood.trust-forwarded-for=true}로
	 * 그 값을 믿는다. 그 밖에는 연결 주소를 쓴다.
	 */
	private String client(HttpServletRequest request) {
		if (trustForwardedFor) {
			String forwarded = request.getHeader("X-Forwarded-For");
			if (forwarded != null && !forwarded.isBlank()) {
				return forwarded.split(",")[0].strip();
			}
		}
		return request.getRemoteAddr();
	}
}
