package org.posegood.api.account;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * /v2/auth/* 계정 HTTP 경로: 가입, 로그인, 로그인 유지(refresh), 로그아웃, 비밀번호, 탈퇴 접수(철회 없음).
 *
 * 로그인하면 access 토큰(JWT)을 본문으로, refresh 토큰을 HttpOnly 쿠키로 준다(ADR 0031). 앱은 access 토큰을
 * {@code Authorization: Bearer}로 보내고, 만료 전에 {@code POST /v2/auth/refresh}로 새로 받는다.
 */
@RestController
@RequestMapping("/v2/auth")
public class AuthController {
    private final AccountService accounts;
    private final CurrentUser current;
    private final AuthenticationManager authentication;
    private final AuthTokens tokens;
    private final boolean secureCookie;
    private final String cookiePath;

    public AuthController(
            AccountService accounts,
            CurrentUser current,
            AuthenticationManager authentication,
            AuthTokens tokens,
            @Value("${posegood.auth.refresh-cookie-secure}") boolean secureCookie,
            @Value("${posegood.auth.refresh-cookie-path}") String cookiePath) {
        this.accounts = accounts;
        this.current = current;
        this.authentication = authentication;
        this.tokens = tokens;
        this.secureCookie = secureCookie;
        this.cookiePath = cookiePath;
    }

    /** 로그인한 내 정보. */
    @GetMapping("/me")
    public AccountContracts.View me() {
        return accounts.requireActive(current.id()).view();
    }

    /** 가입 후 바로 로그인 상태로 만든다(토큰 발급). */
    @PostMapping("/register")
    public AccountContracts.SignedIn register(
            @Valid @RequestBody AccountContracts.Register body, HttpServletResponse response) {
        var account = accounts.register(body);
        return signIn(account, response);
    }

    /** 로그인. 탈퇴 접수한 계정(CLOSED)은 403 ACCOUNT_CLOSED — 되돌릴 수 없고 30일 뒤 삭제된다. */
    @PostMapping("/login")
    public AccountContracts.SignedIn login(
            @Valid @RequestBody AccountContracts.Login body, HttpServletResponse response) {
        if (body.password().getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        Authentication result;
        try {
            result =
                    authentication.authenticate(
                            UsernamePasswordAuthenticationToken.unauthenticated(
                                    body.email(), body.password()));
        } catch (DisabledException closed) {
            throw new ApiError(
                    403, "ACCOUNT_CLOSED", "account is closed and will be deleted 30 days after withdrawal");
        } catch (AuthenticationException invalid) {
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        }
        var account = accounts.requireActive(((AccountPrincipal) result.getPrincipal()).id());
        return signIn(account, response);
    }

    /**
     * 로그인 유지: refresh 쿠키로 새 access·refresh 토큰을 받는다. 쿠키가 없거나 만료·철회·재사용이면 401이고 쿠키를 지운다.
     */
    @PostMapping("/refresh")
    public AccountContracts.Refreshed refresh(
            @CookieValue(name = AuthTokens.REFRESH_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        AuthTokens.Issued issued;
        try {
            issued = tokens.refresh(refreshToken);
        } catch (ApiError expired) {
            clearCookie(response);
            throw expired;
        }
        setCookie(response, issued.refreshToken());
        return new AccountContracts.Refreshed(
                Long.toString(issued.owner()), issued.accessToken(), "Bearer", issued.expiresIn(),
                KstTime.today().toString());
    }

    /** 로그아웃: 이 기기의 refresh 토큰을 철회하고 쿠키를 지운다. access 토큰은 앱이 버린다(만료까지 남음). */
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(
            @CookieValue(name = AuthTokens.REFRESH_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        tokens.signOut(refreshToken);
        clearCookie(response);
    }

    /** 비밀번호 변경: 그 사용자의 refresh 토큰을 모두 철회한다(새 비밀번호로 다시 로그인). */
    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void password(
            @Valid @RequestBody AccountContracts.PasswordChange body, HttpServletResponse response) {
        accounts.changePassword(current.id(), body);
        clearCookie(response);
    }

    /** 탈퇴 접수: 그 사용자의 refresh 토큰을 모두 철회한다. */
    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
            @Valid @RequestBody AccountContracts.Withdrawal body, HttpServletResponse response) {
        accounts.withdraw(current.id(), body);
        clearCookie(response);
    }

    private AccountContracts.SignedIn signIn(AccountRepository.Account account, HttpServletResponse response) {
        var issued = tokens.signIn(account.id());
        setCookie(response, issued.refreshToken());
        return AccountContracts.SignedIn.of(account.view(), issued);
    }

    private void setCookie(HttpServletResponse response, String value) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(value, tokens.refreshLifetime()).toString());
    }

    private void clearCookie(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String value, Duration maxAge) {
        return ResponseCookie.from(AuthTokens.REFRESH_COOKIE, value)
                .httpOnly(true)
                .secure(secureCookie)
                .sameSite("Lax")
                .path(cookiePath)
                .maxAge(maxAge)
                .build();
    }
}
