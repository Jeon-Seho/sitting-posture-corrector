package org.posegood.api.account;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 계정 API의 요청·응답 본문 모음(가입, 로그인, 비밀번호 변경, 탈퇴, 내 정보).
 *
 * 계약 문서: contracts/accounts.v2.md.
 */
public final class AccountContracts {
    private AccountContracts() {}

    public record Profile(
            @NotBlank @Size(max = 30) String name,
            @Min(14) @Max(120) Integer age,
            @Size(min = 1, max = 80) String occupation) {}

    public record Register(
            @Email @NotBlank @Size(max = 254) String email,
            @NotNull @Size(min = 12, max = 72) String password,
            @NotNull @Valid Profile profile,
            @NotNull @Valid List<Consent> consents) {}

    public record Consent(@NotBlank String type, @NotBlank @Size(max = 20) String documentVersion) {}

    public record Login(
            @Email @NotBlank @Size(max = 254) String email,
            @NotNull @Size(min = 1, max = 72) String password) {}

    public record PasswordChange(
            @NotNull String currentPassword, @NotNull @Size(min = 12, max = 72) String newPassword) {}

    public record Withdrawal(@NotNull String password) {}

    /**
     * {@code userId}는 `user_account_id`를 10진수 문자열로 쓴 값이다. {@code today}는 응답을 만든 때의 서버 기준
     * 오늘 날짜(KST {@code YYYY-MM-DD})로, 앱의 「오늘」을 정한다(BE-6, FE ADR 0029).
     */
    public record View(String userId, String email, Profile profile, String today) {}

    /**
     * 가입·로그인 응답: 사용자 정보와 access 토큰(ADR 0031). {@code expiresIn}은 access 토큰의 남은 초다.
     * refresh 토큰은 본문에 넣지 않고 HttpOnly 쿠키로만 준다.
     */
    public record SignedIn(
            String userId, String email, Profile profile, String today, String accessToken, String tokenType,
            long expiresIn) {
        static SignedIn of(View view, AuthTokens.Issued issued) {
            return new SignedIn(view.userId(), view.email(), view.profile(), view.today(), issued.accessToken(),
                    "Bearer", issued.expiresIn());
        }
    }

    /** {@code POST /v2/auth/refresh} 응답: 새 access 토큰. 새 refresh 토큰은 쿠키로 바뀐다. */
    public record Refreshed(String userId, String accessToken, String tokenType, long expiresIn, String today) {}
}
