package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

/** 로그인 고정 만료: 로그인부터 30분이 지나면 활동과 관계없이 세션을 지운다(BE 명세 1장). */
class LoginLifetimeTest {
    private static final Instant SIGNED_IN = Instant.parse("2026-10-26T01:00:00Z");

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static MockHttpServletRequest signedIn(MockHttpSession session) {
        session.setAttribute(LoginLifetime.SIGNED_IN_AT, SIGNED_IN.toEpochMilli());
        var request = new MockHttpServletRequest("GET", "/v2/workspace");
        request.setSession(session);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken("7", null, List.of()));
        return request;
    }

    private static LoginLifetime at(String now) {
        return new LoginLifetime(Duration.ofMinutes(30), Clock.fixed(Instant.parse(now), ZoneOffset.UTC));
    }

    @Test
    void withinThirtyMinutesTheLoginStays() throws Exception {
        var session = new MockHttpSession();
        var request = signedIn(session);
        var chain = new MockFilterChain();
        at("2026-10-26T01:29:59.999Z").doFilter(request, new MockHttpServletResponse(), chain);
        assertSame(request, chain.getRequest());
        assertTrue(!session.isInvalid());
        assertNotNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void afterThirtyMinutesTheLoginEndsEvenIfActive() throws Exception {
        var session = new MockHttpSession();
        var request = signedIn(session);
        var chain = new MockFilterChain();
        at("2026-10-26T01:30:00Z").doFilter(request, new MockHttpServletResponse(), chain);
        // The chain still runs: protected paths then answer 401, /v2/realtime answers closed(unauthorized).
        assertSame(request, chain.getRequest());
        assertTrue(session.isInvalid());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void sessionsWithoutASignInTimeAreLeftToTheIdleTimeout() throws Exception {
        var session = new MockHttpSession();
        var request = new MockHttpServletRequest("GET", "/v2/workspace");
        request.setSession(session);
        at("2026-10-27T00:00:00Z").doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        assertTrue(!session.isInvalid());
    }
}
