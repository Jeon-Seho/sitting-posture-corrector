package org.posegood.api.account;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 계정 API의 요청·응답 본문 모음(가입, 로그인, 비밀번호 변경, 탈퇴, 내 정보).
 *
 * 계약 문서: contracts/accounts.v2.md.
 */
public final class AccountContracts {
	private AccountContracts() {
	}

	public record Profile(
		@NotBlank @Size(max = 30) String name,
		@Min(14) @Max(120) Integer age,
		@Size(min = 1, max = 80) String occupation) {
	}

	public record Register(
		@Email @NotBlank @Size(max = 254) String email,
		@NotNull @Size(min = 12, max = 72) String password,
		@NotNull @Valid Profile profile,
		@NotNull @Valid List<Consent> consents) {
	}

	public record Consent(@NotBlank String type, @NotBlank @Size(max = 20) String documentVersion) {
	}

	public record Login(
		@Email @NotBlank @Size(max = 254) String email,
		@NotNull @Size(min = 1, max = 72) String password) {
	}

	public record PasswordChange(
		@NotNull String currentPassword, @NotNull @Size(min = 12, max = 72) String newPassword) {
	}

	public record Withdrawal(@NotNull String password) {
	}

	/**
	 * {@code userId}는 `user_account_id`를 10진수 문자열로 쓴 값이다. {@code today}는 응답을 만든 때의 서버 기준
	 * 오늘 날짜(KST {@code YYYY-MM-DD})로, 앱의 「오늘」을 정한다(BE-6, FE ADR 0029).
	 */
	public record View(String userId, String email, Profile profile, String today) {
	}

	/**
	 * 가입·로그인 응답: 사용자 정보와 access 토큰(ADR 0031). {@code expiresIn}은 access 토큰의 남은 초다.
	 * refresh 토큰은 본문에 넣지 않고 HttpOnly 쿠키로만 준다.
	 */
	public record SignedIn(
		String userId, String email, Profile profile, String today, String accessToken, String tokenType,
		long expiresIn) {
		static SignedIn of(View view, AuthTokens.Issued issued) {
			return new SignedIn(view.userId(), view.email(), view.profile(), view.today(),
				issued.accessToken(),
				"Bearer", issued.expiresIn());
		}
	}

	/** 소셜 로그인·연결 시작 응답: 브라우저를 보낼 제공자 동의 화면 주소. */
	public record SocialStarted(String authorizeUrl) {
	}

	/** 소셜 가입 대기의 제안값. 이메일은 제공자가 확인한 주소라 바꿀 수 없다. */
	public record SocialSignupDraft(String provider, String email, String suggestedName) {
	}

	/** 소셜 가입 완료 요청. 이메일은 받지 않는다(가입 대기의 확인된 주소를 쓴다). */
	public record SocialSignup(@NotNull @Valid Profile profile, @NotNull @Valid List<Consent> consents) {
	}

	/** 내 로그인 수단: 비밀번호 여부와 제공자별 연결 상태. */
	public record SocialStatus(boolean passwordSet, List<SocialProvider> providers) {
	}

	/** {@code available}은 서버에 그 제공자가 설정됐는지, {@code linkedAt}은 KST 연결 시각(없으면 null)이다. */
	public record SocialProvider(String provider, boolean available, boolean linked, String linkedAt) {
	}

	/** 비밀번호 재설정 메일 요청. */
	public record PasswordResetRequest(@NotBlank @Size(max = 254) String email) {
	}

	/** 비밀번호 재설정 완료. {@code token}은 메일 링크의 일회용 값이다. */
	public record PasswordResetConfirm(
		@NotBlank @Size(max = 128) String token, @NotNull @Size(min = 12, max = 72) String newPassword) {
	}

	/** {@code POST /auth/refresh} 응답: 새 access 토큰. 새 refresh 토큰은 쿠키로 바뀐다. */
	public record Refreshed(String userId, String accessToken, String tokenType, long expiresIn, String today) {
	}
}
