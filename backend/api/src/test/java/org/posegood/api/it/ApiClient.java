package org.posegood.api.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.stream.Collectors;

/** A browser-like client: cookie login session, CSRF header and the stale-tab user header. */
final class ApiClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String base;
    private final CookieManager cookies = new CookieManager();
    private final HttpClient http;
    private String csrf;
    String userId;

    ApiClient(String base) {
        this.base = base;
        http = HttpClient.newBuilder().cookieHandler(cookies).build();
    }

    record Response(int status, JsonNode body) {}

    Response get(String path) throws Exception {
        return send("GET", path, null);
    }

    Response post(String path, Object body) throws Exception {
        return send("POST", path, body);
    }

    Response put(String path, Object body) throws Exception {
        return send("PUT", path, body);
    }

    Response delete(String path, Object body) throws Exception {
        return send("DELETE", path, body);
    }

    /** Fresh CSRF token; required after every sign-in or sign-out. */
    void refreshCsrf() throws Exception {
        csrf = get("/v1/auth/csrf").body().get("token").asText();
    }

    Response register(String email) throws Exception {
        refreshCsrf();
        var body = MAPPER.createObjectNode();
        body.put("email", email).put("password", "synthetic-password-1").put("consent_version", "service-v1");
        body.putObject("profile").put("name", "합성 사용자").put("age", 30).put("occupation", "합성 시험");
        var response = post("/v1/auth/register", body);
        if (response.status() == 200) userId = response.body().get("user_id").asText();
        refreshCsrf();
        return response;
    }

    Response login(String email, String password) throws Exception {
        refreshCsrf();
        var body = MAPPER.createObjectNode().put("email", email).put("password", password);
        var response = post("/v1/auth/login", body);
        if (response.status() == 200) userId = response.body().get("user_id").asText();
        refreshCsrf();
        return response;
    }

    /** The {@code Cookie} header for a WebSocket handshake. */
    String cookieHeader() {
        return cookies.getCookieStore().getCookies().stream()
                .map(cookie -> cookie.getName() + "=" + cookie.getValue())
                .collect(Collectors.joining("; "));
    }

    String base() {
        return base;
    }

    private Response send(String method, String path, Object body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(base + path)).header("Accept", "application/json");
        if (csrf != null && !"GET".equals(method)) builder.header("X-CSRF-TOKEN", csrf);
        if (userId != null) builder.header("X-PoseGood-User-Id", userId);
        if (body == null) builder.method(method, HttpRequest.BodyPublishers.noBody());
        else
            builder.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)));
        var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode parsed = response.body().isBlank() ? null : MAPPER.readTree(response.body());
        return new Response(response.statusCode(), parsed);
    }
}
