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

@RestController
@RequestMapping("/v1/auth")
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

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("header_name", token.getHeaderName(), "token", token.getToken());
    }

    @GetMapping("/me")
    public AccountContracts.View me() {
        return accounts.requireActive(current.id()).view();
    }

    @PostMapping("/register")
    public AccountContracts.View register(
            @Valid @RequestBody AccountContracts.Register body,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account = accounts.register(body);
        signIn(AccountAuthenticationProvider.authenticated(account), request, response);
        return account.view();
    }

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
                    403, "ACCOUNT_CLOSED", "account withdrawal is pending; cancel it to sign in");
        } catch (AuthenticationException invalid) {
            throw new ApiError(401, "INVALID_CREDENTIALS", "invalid credentials");
        }
        signIn(result, request, response);
        return accounts.requireActive(((AccountPrincipal) result.getPrincipal()).id()).view();
    }

    /** Cancels a withdrawal inside its grace period and signs the account in again. */
    @PostMapping("/withdrawal/cancel")
    public AccountContracts.View cancelWithdrawal(
            @Valid @RequestBody AccountContracts.Login body,
            HttpServletRequest request,
            HttpServletResponse response) {
        var account = accounts.cancelWithdrawal(body);
        signIn(AccountAuthenticationProvider.authenticated(account), request, response);
        return account.view();
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
        accounts.changePassword(current.id(), body);
        clear(request, response);
    }

    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
            @Valid @RequestBody AccountContracts.Withdrawal body,
            HttpServletRequest request,
            HttpServletResponse response) {
        accounts.withdraw(current.id(), body);
        clear(request, response);
    }

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

    private void clear(HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        tokens.saveToken(null, request, response);
    }
}
