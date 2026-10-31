package org.posegood.api.it;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 통합 시험용 HTTP 클라이언트: access 토큰(Bearer), refresh 쿠키, 사용자 헤더(ADR 0031).
 */
final class ApiClient {
	private static final ObjectMapper MAPPER = new ObjectMapper();

	private final String base;
	private final CookieManager cookies = new CookieManager();
	private final HttpClient http;
	private String accessToken;
	String userId;

	ApiClient(String base) {
		this.base = base;
		http = HttpClient.newBuilder().cookieHandler(cookies).build();
	}

	record Response(int status, JsonNode body) {
	}

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

	/** refresh 쿠키로 새 access 토큰을 받는다(성공하면 바꿔 끼운다). */
	Response refresh() throws Exception {
		var response = post("/v2/auth/refresh", null);
		if (response.status() == 200) {
			accessToken = response.body().get("access_token").asString();
		}
		return response;
	}

	Response register(String email) throws Exception {
		var body = MAPPER.createObjectNode();
		body.put("email", email).put("password", "synthetic-password-1");
		var consents = body.putArray("consents");
		for (var type : java.util.List.of("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD",
			"AGE_14_OVER", "OPTIONAL_PROFILE")) {
			consents.addObject().put("type", type).put("document_version", "service-v2");
		}
		body.putObject("profile").put("name", "합성 사용자").put("age", 30).put("occupation", "합성 시험");
		return signedIn(post("/v2/auth/register", body));
	}

	Response login(String email, String password) throws Exception {
		var body = MAPPER.createObjectNode().put("email", email).put("password", password);
		return signedIn(post("/v2/auth/login", body));
	}

	/** 실시간 hello에 넣을 access 토큰(로그인 전이면 null). */
	String accessToken() {
		return accessToken;
	}

	private Response signedIn(Response response) {
		if (response.status() == 200) {
			userId = response.body().get("user_id").asString();
			accessToken = response.body().get("access_token").asString();
		}
		return response;
	}

	String base() {
		return base;
	}

	private Response send(String method, String path, Object body) throws Exception {
		var builder = HttpRequest.newBuilder(URI.create(base + path)).header("Accept", "application/json");
		if (accessToken != null) {
			builder.header("Authorization", "Bearer " + accessToken);
		}
		if (userId != null) {
			builder.header("X-PoseGood-User-Id", userId);
		}
		if (body == null) {
			builder.method(method, HttpRequest.BodyPublishers.noBody());
		} else {
			builder.header("Content-Type", "application/json")
				.method(method, HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)));
		}
		var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
		JsonNode parsed = response.body().isBlank() ? null : MAPPER.readTree(response.body());
		return new Response(response.statusCode(), parsed);
	}
}
