package org.posegood.api.account;

import org.posegood.api.web.ApiError;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@Profile("persistent")
public class CurrentUser {
    private final UserStore users;

    public CurrentUser(UserStore users) {
        this.users = users;
    }

    public UUID id() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated())
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        try {
            var id = UUID.fromString(authentication.getName());
            var user = users.require(id);
            if (!(authentication.getPrincipal() instanceof AccountPrincipal principal)
                    || principal.epoch() != user.epoch())
                throw new ApiError(401, "UNAUTHENTICATED", "authentication revoked");
            return id;
        } catch (IllegalArgumentException invalid) {
            throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        }
    }
}
