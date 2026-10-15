package org.posegood.api.account;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 다른 탭에서 계정이 바뀐 오래된 화면의 쓰기를 막는 필터(X-PoseGood-User-Id가 다르면 409).
 *
 * 이 헤더는 사용자를 고르거나 인증하는 데 쓰지 않는다. 브라우저는 WebSocket에 헤더를 붙일 수 없어서
 * 실시간 채널은 hello 메시지에서 소유자를 확인한다.
 */
public class IdentityGuard extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        boolean guarded =
                path.startsWith("/v2/workspace")
                        || path.startsWith("/v2/baselines")
                        || path.startsWith("/v2/consents")
                        || path.startsWith("/v2/records")
                        || path.startsWith("/v2/sessions")
                        || path.equals("/v2/auth/password")
                        || path.equals("/v2/auth/account")
                        || path.equals("/v2/auth/logout");
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (guarded
                && auth != null
                && auth.isAuthenticated()
                && auth.getPrincipal() instanceof AccountPrincipal
                && !auth.getName().equals(request.getHeader("X-PoseGood-User-Id"))) {
            response.setStatus(409);
            response.setContentType("application/json");
            response.getWriter()
                    .write(
                            "{\"error\":\"account changed\",\"code\":\"AUTH_CHANGED\","
                                    + "\"message\":\"account changed; reload authentication\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
