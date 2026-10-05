package org.posegood.api.account;

import java.io.Serializable;
import java.security.Principal;
import java.util.UUID;

/** A late session save cannot revive a login from before password revocation. */
public record AccountPrincipal(UUID id, long epoch) implements Principal, Serializable {
    private static final long serialVersionUID = 1L;

    @Override
    public String getName() {
        return id.toString();
    }
}
