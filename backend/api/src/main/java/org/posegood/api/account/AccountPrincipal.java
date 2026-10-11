package org.posegood.api.account;

import java.io.Serializable;
import java.security.Principal;

/**
 * 로그인 세션에 저장되는 사용자 식별자. 이름(ID)이 SPRING_SESSION.PRINCIPAL_NAME이 된다.
 *
 * 비밀번호 변경·탈퇴 때 이 이름으로 그 계정의 로그인 세션 행을 모두 찾아 지운다(스키마 V2.1).
 */
public record AccountPrincipal(long id) implements Principal, Serializable {
    private static final long serialVersionUID = 4L;

    @Override
    public String getName() {
        return Long.toString(id);
    }
}
