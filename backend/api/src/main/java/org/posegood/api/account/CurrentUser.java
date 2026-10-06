package org.posegood.api.account;

import org.posegood.api.web.ApiError;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
@Profile("persistent")
public class CurrentUser {
    private final UserStore users;

    public CurrentUser(UserStore users) {
        this.users = users;
    }

    public long id() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated())
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        if (!(authentication.getPrincipal() instanceof AccountPrincipal principal))
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        var user = users.require(principal.id());
        if (principal.epoch() != user.epoch())
            throw new ApiError(401, "UNAUTHENTICATED", "authentication revoked");
        return principal.id();
    }
}
