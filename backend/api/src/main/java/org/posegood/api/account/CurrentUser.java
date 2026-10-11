package org.posegood.api.account;

import org.posegood.api.common.ApiError;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * 요청을 보낸 로그인 사용자의 ID를 꺼낸다(정상 계정이 아니면 401).
 *
 * 끊긴 로그인은 `SPRING_SESSION` 행이 없으므로 여기까지 오지 않는다.
 */
@Component
public class CurrentUser {
    private final AccountService accounts;

    public CurrentUser(AccountService accounts) {
        this.accounts = accounts;
    }

    public long id() {
        return id(SecurityContextHolder.getContext().getAuthentication());
    }

    public long id(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AccountPrincipal principal))
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        accounts.requireActive(principal.id());
        return principal.id();
    }
}
