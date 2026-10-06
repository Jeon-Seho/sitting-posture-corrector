package org.posegood.api.account;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

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
            @NotNull String currentPassword,
            @NotNull @Size(min = 12, max = 72) String newPassword) {}

    public record Withdrawal(@NotNull String password) {}

    /** {@code userId} is the decimal `user_account_id` of schema V1.1. */
    public record View(String userId, String email, Profile profile) {}
}
