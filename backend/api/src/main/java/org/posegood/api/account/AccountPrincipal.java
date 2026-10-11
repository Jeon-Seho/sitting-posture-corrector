package org.posegood.api.account;

import java.io.Serializable;
import java.security.Principal;

/**
 * Stored in the DB login session. The name is the `SPRING_SESSION.PRINCIPAL_NAME` by which a
 * password change or a withdrawal deletes every login of the account (schema V2.1).
 */
public record AccountPrincipal(long id) implements Principal, Serializable {
    private static final long serialVersionUID = 4L;

    @Override
    public String getName() {
        return Long.toString(id);
    }
}
