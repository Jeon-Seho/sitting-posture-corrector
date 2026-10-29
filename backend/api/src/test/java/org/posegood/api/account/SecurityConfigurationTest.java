package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.DefaultCorsProcessor;

import java.util.List;

/** 다른 출처 화면의 요청 허용(fe-deploy S-1). 전체 필터 체인은 MySQL 통합 시험이 확인한다. */
class SecurityConfigurationTest {
    private static final String APP = "https://app.example.test";

    private static MockHttpServletRequest preflight(String path, String origin, String headers) {
        var request = new MockHttpServletRequest("OPTIONS", path);
        request.setServerName("api.example.test");
        request.addHeader("Origin", origin);
        request.addHeader("Access-Control-Request-Method", "POST");
        request.addHeader("Access-Control-Request-Headers", headers);
        return request;
    }

    private static MockHttpServletResponse process(CorsConfigurationSource source, MockHttpServletRequest request)
            throws Exception {
        var response = new MockHttpServletResponse();
        boolean passed = new DefaultCorsProcessor().processRequest(source.getCorsConfiguration(request), request, response);
        if (!passed) assertEquals(403, response.getStatus());
        return response;
    }

    @Test
    void anAllowedOriginGetsTheAllowHeadersWithCredentials() throws Exception {
        var source = SecurityConfiguration.corsSource(List.of(APP));
        for (var request : List.of(
                preflight("/v2/auth/login", APP, "content-type"),
                preflight("/v2/sessions/00000000-0000-0000-0000-000000000001", APP, "authorization,content-type"))) {
            var response = process(source, request);
            assertEquals(200, response.getStatus());
            assertEquals(APP, response.getHeader("Access-Control-Allow-Origin"));
            assertEquals("true", response.getHeader("Access-Control-Allow-Credentials"));
            assertEquals("3600", response.getHeader("Access-Control-Max-Age"));
        }
    }

    @Test
    void otherOriginsMethodsAndHeadersAreRefused() throws Exception {
        var source = SecurityConfiguration.corsSource(List.of(APP));
        assertEquals(403, process(source, preflight("/v2/auth/login", "https://evil.example", "content-type")).getStatus());
        assertEquals(403, process(source, preflight("/v2/auth/login", "http://app.example.test", "content-type")).getStatus());
        assertEquals(403, process(source, preflight("/v2/auth/login", APP, "x-csrf-token")).getStatus());
        var patch = preflight("/v2/auth/me", APP, "authorization");
        patch.removeHeader("Access-Control-Request-Method");
        patch.addHeader("Access-Control-Request-Method", "PATCH");
        assertEquals(403, process(source, patch).getStatus());
    }

    @Test
    void anEmptySettingLeavesEveryPathWithoutCors() {
        // 같은 출처 화면이라도 nginx가 Host의 포트를 떼면 다른 출처로 보일 수 있다 — 설정이 없으면 막지 않는다.
        for (var origins : List.of(List.<String>of(), List.of(""), List.of(" ", " "))) {
            var request = preflight("/v2/auth/login", "http://localhost:8080", "content-type");
            assertNull(SecurityConfiguration.corsSource(origins).getCorsConfiguration(request));
        }
    }

    @Test
    void originsAreTrimmedAndAWildcardIsRejected() {
        var config = SecurityConfiguration.corsSource(List.of(" " + APP, "https://preview.example.test "))
                .getCorsConfiguration(preflight("/health", APP, "content-type"));
        assertEquals(List.of(APP, "https://preview.example.test"), config.getAllowedOrigins());
        assertTrue(config.getAllowCredentials());
        assertFalse(config.getAllowedHeaders().contains("X-CSRF-TOKEN"));
        assertThrows(IllegalStateException.class, () -> SecurityConfiguration.corsSource(List.of("*")));
    }
}
