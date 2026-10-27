package org.posegood.api.account;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;

/**
 * 로그인 고정 만료: 로그인한 때부터 {@code lifetime}이 지나면 HTTP·WebSocket 활동과 관계없이 로그인을 끝낸다(BE 명세 1장).
 *
 * 로그인 시각은 {@link AuthController}가 세션에 남긴다. 지난 세션은 지우고 인증 없이 다음 필터로 넘긴다 —
 * 보호된 경로는 401 {@code UNAUTHENTICATED}, 실시간 연결은 hello에서 {@code closed(unauthorized)}가 된다.
 * 이미 인증된 측정 연결은 끊지 않는다. 로그인 시각이 없는 세션(이 필터 이전에 로그인)은 마지막 요청 기준 만료만 따른다.
 */
public class LoginLifetime extends OncePerRequestFilter {
    /** 로그인 시각(epoch ms)을 담는 세션 속성. */
    static final String SIGNED_IN_AT = "posegood.signedInAt";

    private final Duration lifetime;
    private final Clock clock;

    public LoginLifetime(Duration lifetime, Clock clock) {
        this.lifetime = lifetime;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var session = request.getSession(false);
        if (session != null
                && session.getAttribute(SIGNED_IN_AT) instanceof Long signedInAt
                && clock.millis() - signedInAt >= lifetime.toMillis()) {
            session.invalidate();
            SecurityContextHolder.clearContext();
        }
        chain.doFilter(request, response);
    }
}
