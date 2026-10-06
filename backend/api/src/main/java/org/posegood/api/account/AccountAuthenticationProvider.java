package org.posegood.api.account;

import org.springframework.context.annotation.Profile;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

@Component
@Profile("persistent")
public class AccountAuthenticationProvider implements AuthenticationProvider {
    private final UserStore users;
    private final PasswordEncoder passwords;
    private final String dummyHash;

    public AccountAuthenticationProvider(UserStore users, PasswordEncoder passwords) {
        this.users = users;
        this.passwords = passwords;
        dummyHash = passwords.encode(java.util.UUID.randomUUID().toString());
    }

    public Authentication authenticate(Authentication request) {
        var user = users.findEmail(request.getName().strip().toLowerCase(Locale.ROOT));
        boolean matches =
                passwords.matches(
                        String.valueOf(request.getCredentials()),
                        user == null ? dummyHash : user.hash());
        if (user == null || !matches) throw new BadCredentialsException("invalid credentials");
        return UsernamePasswordAuthenticationToken.authenticated(
                new AccountPrincipal(user.id(), user.epoch()),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    public boolean supports(Class<?> type) {
        return UsernamePasswordAuthenticationToken.class.isAssignableFrom(type);
    }
}
