package org.posegood.api.account;

import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Email and password sign-in. A missing account still runs one hash comparison. A CLOSED account
 * with the right password is reported separately so the app can offer the withdrawal cancel.
 */
@Component
public class AccountAuthenticationProvider implements AuthenticationProvider {
    private final AccountRepository accounts;
    private final PasswordEncoder passwords;
    private final String dummyHash;

    public AccountAuthenticationProvider(AccountRepository accounts, PasswordEncoder passwords) {
        this.accounts = accounts;
        this.passwords = passwords;
        dummyHash = passwords.encode(UUID.randomUUID().toString());
    }

    @Override
    public Authentication authenticate(Authentication request) {
        var account = accounts.findEmail(AccountService.normalize(request.getName()));
        boolean matches =
                passwords.matches(
                        String.valueOf(request.getCredentials()),
                        account == null ? dummyHash : account.hash());
        if (account == null || !matches) throw new BadCredentialsException("invalid credentials");
        if (!account.active()) throw new DisabledException("account closed");
        return authenticated(account);
    }

    static Authentication authenticated(AccountRepository.Account account) {
        return UsernamePasswordAuthenticationToken.authenticated(
                new AccountPrincipal(account.id()),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    @Override
    public boolean supports(Class<?> type) {
        return UsernamePasswordAuthenticationToken.class.isAssignableFrom(type);
    }
}
