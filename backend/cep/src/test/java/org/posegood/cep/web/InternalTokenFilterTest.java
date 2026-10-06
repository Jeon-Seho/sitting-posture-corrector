package org.posegood.cep.web;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class InternalTokenFilterTest {
    private static final String TOKEN = "synthetic_internal_token_1234567890";

    @Test
    void missingWrongAndDuplicateTokensAreRejectedButHealthRemainsPublic() throws Exception {
        var filter = new InternalTokenFilter(true, TOKEN);
        for (String value : new String[] {"", "synthetic_wrong_token", TOKEN}) {
            var request = new MockHttpServletRequest("PUT", "/internal/sessions/synthetic");
            if (!value.isEmpty()) request.addHeader("X-PoseGood-Internal-Token", value);
            if (value.equals(TOKEN)) request.addHeader("X-PoseGood-Internal-Token", TOKEN);
            var response = new MockHttpServletResponse();
            filter.doFilter(
                    request, response, (req, res) -> fail("protected route must not be called"));
            assertEquals(401, response.getStatus());
        }
        var response = new MockHttpServletResponse();
        filter.doFilter(
                new MockHttpServletRequest("GET", "/health"),
                response,
                (req, res) -> res.getWriter().write("synthetic health"));
        assertEquals("synthetic health", response.getContentAsString());
    }

    @Test
    void developmentCompatibilityAndCorrectInternalHeaderAreExplicit() throws Exception {
        var request =
                new MockHttpServletRequest("POST", "/internal/sessions/synthetic/observations");
        request.addHeader("X-PoseGood-Internal-Token", TOKEN);
        var response = new MockHttpServletResponse();
        new InternalTokenFilter(true, TOKEN)
                .doFilter(request, response, (req, res) -> res.getWriter().write("accepted"));
        assertEquals("accepted", response.getContentAsString());
        var development = new MockHttpServletResponse();
        new InternalTokenFilter(false, "")
                .doFilter(
                        new MockHttpServletRequest("GET", "/internal/sessions/synthetic"),
                        development,
                        (req, res) -> res.getWriter().write("development"));
        assertEquals("development", development.getContentAsString());
        assertThrows(IllegalArgumentException.class, () -> new InternalTokenFilter(true, ""));
    }
}
