package org.posegood.api.account;

import org.posegood.api.common.ApiError;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * The owner of every protected request: the authenticated principal of an ACTIVE account. Revoked
 * logins have no `SPRING_SESSION` row left, so they never reach this point.
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
