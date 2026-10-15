package org.posegood.api.account;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

import org.posegood.api.common.ApiError;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/** /v2/auth/* 계정 HTTP 경로: CSRF, 가입, 로그인, 로그아웃, 비밀번호, 탈퇴, 철회. */
@RestController
@RequestMapping("/v2/auth")
public class AuthController {
    private final AccountService accounts;
    private final CurrentUser current;
    private final AuthenticationManager authentication;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository tokens;

    public AuthController(
            AccountService accounts,
            CurrentUser current,
            AuthenticationManager authentication,
            HttpSessionSecurityContextRepository contexts,
            HttpSessionCsrfTokenRepository tokens) {
        this.accounts = accounts;
        this.current = current;
        this.authentication = authentication;
        this.contexts = contexts;
        this.tokens = tokens;
    }

    /** CSRF 토큰 발급. 상태를 바꾸는 요청마다 X-CSRF-TOKEN 헤더로 보낸다. */
    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("header_name", token.getHeaderName(), "token", token.getToken());
    }

    /** 로그인한 내 정보. */
    @GetMapping("/me")
    public AccountContracts.View me() {
        return accounts.requireActive(current.id()).view();
    }

    /** 가입 후 바로 로그인 상태로 만든다. */
    @PostMapping("/register")
    public AccountContracts.View register(
            @Valid @RequestBody AccountContracts.Register body,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account = accounts.register(body);
        signIn(AccountAuthenticationProvider.authenticated(account), request, response);
        return account.view();
    }

    /** 로그인. 탈퇴 접수한 계정(CLOSED)은 403 ACCOUNT_CLOSED — 되돌릴 수 없고 30일 뒤 삭제된다. */
    @PostMapping("/login")
    public AccountContracts.View login(
            @Valid @RequestBody AccountContracts.Login body,
            HttpServletRequest request,
            HttpServletResponse response) {
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
        signIn(result, request, response);
        return accounts.requireActive(((AccountPrincipal) result.getPrincipal()).id()).view();
    }

    /** 로그아웃: 현재 세션을 지운다. */
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        clear(request, response);
    }

    /** 비밀번호 변경 후 현재 세션도 끝낸다(새 비밀번호로 다시 로그인). */
    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void password(
            @Valid @RequestBody AccountContracts.PasswordChange body,
            HttpServletRequest request,
            HttpServletResponse response) {
        accounts.changePassword(current.id(), body);
        clear(request, response);
    }

    /** 탈퇴 접수 후 현재 세션을 끝낸다. */
    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
            @Valid @RequestBody AccountContracts.Withdrawal body,
            HttpServletRequest request,
            HttpServletResponse response) {
        accounts.withdraw(current.id(), body);
        clear(request, response);
    }

    /** 로그인 처리: 세션 ID를 새로 만들고 인증 정보와 CSRF 토큰을 DB 세션에 저장한다. */
    private void signIn(
            Authentication auth, HttpServletRequest request, HttpServletResponse response) {
        request.getSession(true);
        request.changeSessionId();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        tokens.saveToken(null, request, response);
    }

    /** 세션·인증 정보·CSRF 토큰을 비운다. */
    private void clear(HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        tokens.saveToken(null, request, response);
    }
}
