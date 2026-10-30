package org.posegood.api.account;

import java.io.Serializable;
import java.security.Principal;

/**
 * 로그인한 사용자 식별자. access 토큰(JWT)의 {@code sub}가 이 ID(10진수 문자열)다(ADR 0031).
 */
public record AccountPrincipal(long id) implements Principal, Serializable {
    private static final long serialVersionUID = 4L;

    @Override
    public String getName() {
        return Long.toString(id);
    }
}
