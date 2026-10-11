package org.posegood.api.account;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * {@code X-PoseGood-User-Id} detects a stale tab after the login changed elsewhere; it never selects
 * or authenticates an owner. Browsers cannot set headers on a WebSocket, so the realtime path checks
 * the owner in its hello message instead.
 */
public class IdentityGuard extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        boolean guarded =
                path.startsWith("/v1/workspace")
                        || path.startsWith("/v1/records")
                        || path.startsWith("/v1/sessions")
                        || path.equals("/v1/auth/password")
                        || path.equals("/v1/auth/account")
                        || path.equals("/v1/auth/logout");
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
