package org.posegood.api.account;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

import org.posegood.api.persistence.UserLocks;
import org.posegood.api.web.ApiError;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;

@RestController
@Profile("persistent")
@RequestMapping("/v1/auth")
public class AuthController {
    private final UserStore users;
    private final CurrentUser current;
    private final UserLocks locks;
    private final PasswordEncoder passwords;
    private final AuthenticationManager authentication;
    private final HttpSessionSecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository tokens;

    public AuthController(
            UserStore users,
            CurrentUser current,
            UserLocks locks,
            PasswordEncoder passwords,
            AuthenticationManager authentication,
            HttpSessionSecurityContextRepository contexts,
            HttpSessionCsrfTokenRepository tokens) {
        this.users = users;
        this.current = current;
        this.locks = locks;
        this.passwords = passwords;
        this.authentication = authentication;
        this.contexts = contexts;
        this.tokens = tokens;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("header_name", token.getHeaderName(), "token", token.getToken());
    }

    @GetMapping("/me")
    public AccountContracts.View me() {
        return users.require(current.id()).view();
    }

    @PostMapping("/register")
    public AccountContracts.View register(
            @Valid @RequestBody AccountContracts.Register body,
            HttpServletRequest request,
            HttpServletResponse response) {
        requirePassword(body.password());
        if (!"service-v1".equals(body.consentVersion()))
            throw new ApiError(400, "CONSENT_REQUIRED", "service storage consent required");
        var user =
                users.register(
                        body.email().strip().toLowerCase(Locale.ROOT),
                        passwords.encode(body.password()),
                        body.profile());
        signIn(
                UsernamePasswordAuthenticationToken.authenticated(
                        new AccountPrincipal(user.id(), user.epoch()),
                        null,
                        java.util.List.of(
                                new org.springframework.security.core.authority
                                        .SimpleGrantedAuthority("ROLE_USER"))),
                request,
                response);
        return user.view();
    }

    @PostMapping("/login")
    public AccountContracts.View login(
            @Valid @RequestBody AccountContracts.Login body,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (body.password().getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        try {
            var found = users.findEmail(body.email().strip().toLowerCase(Locale.ROOT));
            if (found == null)
                authentication.authenticate(
                        UsernamePasswordAuthenticationToken.unauthenticated(
                                body.email(), body.password()));
            else
                locks.withLock(
                        found.id(),
                        () -> {
                            users.require(found.id());
                            signIn(
                                    authentication.authenticate(
                                            UsernamePasswordAuthenticationToken.unauthenticated(
                                                    body.email(), body.password())),
                                    request,
                                    response);
                            return null;
                        });
        } catch (AuthenticationException error) {
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        }
        return me();
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        clear(request, response);
    }

    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void password(
            @Valid @RequestBody AccountContracts.PasswordChange body,
            HttpServletRequest request,
            HttpServletResponse response) {
        requirePassword(body.newPassword());
        var id = current.id();
        locks.withLock(
                id,
                () -> {
                    current.id();
                    var user = users.require(id);
                    requireCurrent(body.currentPassword(), user.hash());
                    users.changePassword(id, passwords.encode(body.newPassword()));
                    return null;
                });
        clear(request, response);
    }

    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
            @Valid @RequestBody AccountContracts.Withdrawal body,
            HttpServletRequest request,
            HttpServletResponse response) {
        var id = current.id();
        locks.withLock(
                id,
                () -> {
                    current.id();
                    var user = users.require(id);
                    requireCurrent(body.password(), user.hash());
                    users.delete(id);
                    return null;
                });
        clear(request, response);
    }

    private void signIn(
            org.springframework.security.core.Authentication auth,
            HttpServletRequest request,
            HttpServletResponse response) {
        request.getSession(true);
        request.changeSessionId();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        tokens.saveToken(null, request, response);
    }

    private void clear(HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        tokens.saveToken(null, request, response);
    }

    private void requireCurrent(String password, String hash) {
        if (password.getBytes(StandardCharsets.UTF_8).length > 72
                || !passwords.matches(password, hash))
            throw new ApiError(400, "INVALID_PASSWORD", "current password is incorrect");
    }

    private void requirePassword(String password) {
        if (password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiError(
                    400,
                    "INVALID_PASSWORD",
                    "password must have 12 or more characters and at most 72 UTF-8 bytes");
    }
}
