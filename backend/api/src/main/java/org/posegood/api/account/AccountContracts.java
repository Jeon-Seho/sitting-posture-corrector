package org.posegood.api.account;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Request and response bodies of contracts/accounts.v1.md. */
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

    /** {@code userId} is the decimal `user_account_id`. */
    public record View(String userId, String email, Profile profile) {}
}
