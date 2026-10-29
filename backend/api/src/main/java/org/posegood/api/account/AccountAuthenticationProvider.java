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
 * 로그인할 때 이메일·비밀번호를 확인한다. 탈퇴 접수한(CLOSED) 계정은 로그인할 수 없다.
 *
 * 없는 계정이어도 해시 비교를 한 번 해서 응답 시간으로 계정 유무를 알 수 없게 한다.
 * 탈퇴는 철회할 수 없다(아키텍처 v5.2). 비밀번호가 맞는 CLOSED 계정은 따로 알려
 * 앱이 "탈퇴 처리 중, 30일 뒤 삭제"를 안내하게 한다(같은 이메일 재가입도 삭제 전까지 막힌다).
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

    /** 로그인 검증: 계정 조회 → 비밀번호 비교 → 성공하면 인증 정보를 만든다. */
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

    /** 로그인 확인 결과(사용자 ID만 담음). 토큰 발급에 쓴다. */
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
