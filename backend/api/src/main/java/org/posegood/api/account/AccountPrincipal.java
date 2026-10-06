package org.posegood.api.account;

import java.io.Serializable;
import java.security.Principal;

/** A late session save cannot revive a login from before password revocation. */
public record AccountPrincipal(long id, long epoch) implements Principal, Serializable {
    private static final long serialVersionUID = 2L;

    @Override
    public String getName() {
        return Long.toString(id);
    }
}
