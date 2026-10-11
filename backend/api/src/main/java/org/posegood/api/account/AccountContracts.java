package org.posegood.api.account;

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
 * 계약 문서: contracts/accounts.v1.md.
 */
public final class AccountContracts {
    private AccountContracts() {}

    public record Profile(
            @NotBlank @Size(max = 30) String name,
            @Min(1) @Max(120) int age,
            @NotBlank @Size(max = 80) String occupation) {}

    public record Register(
            @Email @NotBlank @Size(max = 254) String email,
            @NotNull @Size(min = 12, max = 72) String password,
            @NotNull @Valid Profile profile,
            @NotNull String consentVersion) {}

    public record Login(
            @Email @NotBlank @Size(max = 254) String email,
            @NotNull @Size(min = 1, max = 72) String password) {}

    public record PasswordChange(
            @NotNull String currentPassword, @NotNull @Size(min = 12, max = 72) String newPassword) {}

    public record Withdrawal(@NotNull String password) {}

    /** {@code userId}는 `user_account_id`를 10진수 문자열로 쓴 값이다. */
    public record View(String userId, String email, Profile profile) {}
}
