package org.posegood.cep.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;

@Component
public class InternalTokenFilter extends OncePerRequestFilter {
    private final boolean required;
    private final byte[] token;

    public InternalTokenFilter(
            @Value("${posegood.require-internal-token:false}") boolean required,
            @Value("${posegood.internal-token:}") String token) {
        if (required && !token.matches("[A-Za-z0-9_-]{32,512}"))
            throw new IllegalArgumentException("internal token configuration required");
        this.required = required;
        this.token = token.getBytes(StandardCharsets.US_ASCII);
    }

    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (required && !request.getRequestURI().equals("/health")) {
            var headers = Collections.list(request.getHeaders("X-PoseGood-Internal-Token"));
            if (headers.size() != 1
                    || !MessageDigest.isEqual(
                            token, headers.getFirst().getBytes(StandardCharsets.US_ASCII))) {
                response.setStatus(401);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"internal authentication required\"}");
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
