package org.posegood.api.account;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import tools.jackson.databind.JsonNode;

/**
 * Discord OAuth 2.0(인가 코드 + PKCE S256) 연결. 범위는 {@code identify email}만 쓴다.
 *
 * <p>{@code posegood.auth.discord.client-id}가 비어 있으면 꺼진다({@link #enabled()}). client secret은 서버 환경변수에만
 * 두고 앱·로그에 내보내지 않는다. Discord가 준 access 토큰은 사용자 확인 한 번에만 쓰고 저장하지 않는다.
 */
@Component
public class DiscordClient implements SocialProviderClient {
	static final String AUTHORIZE = "https://discord.com/oauth2/authorize";
	static final String API = "https://discord.com/api/v10";

	private final String clientId;
	private final String clientSecret;
	private final String redirectUri;
	private final RestClient client;

	public DiscordClient(
		RestClient.Builder builder,
		@Value("${posegood.auth.discord.client-id:}")
		String clientId,
		@Value("${posegood.auth.discord.client-secret:}")
		String clientSecret,
		@Value("${posegood.auth.discord.redirect-uri:}")
		String redirectUri) {
		this.clientId = clientId.strip();
		this.clientSecret = clientSecret.strip();
		this.redirectUri = redirectUri.strip();
		if (enabled() && (this.clientSecret.isEmpty() || !this.redirectUri.startsWith("http"))) {
			throw new IllegalStateException(
				"posegood.auth.discord needs client-secret and an absolute redirect-uri when client-id is set");
		}
		var factory = new SimpleClientHttpRequestFactory();
		factory.setConnectTimeout(3000);
		factory.setReadTimeout(5000);
		client = builder.clone().baseUrl(API).requestFactory(factory).build();
	}

	@Override
	public String id() {
		return "discord";
	}

	/** Discord 로그인이 설정됐는가. */
	@Override
	public boolean enabled() {
		return !clientId.isEmpty();
	}

	/** 브라우저를 보낼 Discord 동의 화면 주소. */
	@Override
	public URI authorizeUrl(String state, String codeChallenge) {
		return UriComponentsBuilder.fromUriString(AUTHORIZE)
			.queryParam("response_type", "code")
			.queryParam("client_id", clientId)
			.queryParam("scope", "identify email")
			.queryParam("redirect_uri", redirectUri)
			.queryParam("state", state)
			.queryParam("code_challenge", codeChallenge)
			.queryParam("code_challenge_method", "S256")
			// 이미 허락한 사용자는 다시 묻지 않는다(Discord: consent | none).
			.queryParam("prompt", "none")
			.encode(StandardCharsets.UTF_8)
			.build()
			.toUri();
	}

	/** 인가 코드를 Discord 사용자로 바꾼다. 실패하면 502 SOCIAL_UPSTREAM(상세 내용은 남기지 않는다). */
	@Override
	public SocialUser exchange(String code, String codeVerifier) {
		try {
			var form = new LinkedMultiValueMap<String, String>();
			form.add("grant_type", "authorization_code");
			form.add("code", code);
			form.add("redirect_uri", redirectUri);
			form.add("code_verifier", codeVerifier);
			String basic = Base64.getEncoder()
				.encodeToString((clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
			JsonNode token = client.post()
				.uri("/oauth2/token")
				.header(HttpHeaders.AUTHORIZATION, "Basic " + basic)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.body(form)
				.retrieve()
				.body(JsonNode.class);
			String access = token == null ? "" : Json.text(token.path("access_token"));
			if (access.isEmpty()) {
				throw upstream();
			}
			JsonNode user = client.get()
				.uri("/users/@me")
				.header(HttpHeaders.AUTHORIZATION, "Bearer " + access)
				.retrieve()
				.body(JsonNode.class);
			return parseUser(user);
		} catch (RestClientException unavailable) {
			throw upstream();
		}
	}

	private static ApiError upstream() {
		return new ApiError(502, "SOCIAL_UPSTREAM", "social login provider did not answer");
	}

	/**
	 * Discord {@code /users/@me} 응답을 공통 사용자로 바꾼다. {@code email}은 Discord가 확인한(verified) 주소일 때만 채운다.
	 */
	static SocialUser parseUser(JsonNode user) {
		if (user == null) {
			throw upstream();
		}
		String id = Json.text(user.path("id"));
		if (!id.matches("[0-9]{1,32}")) {
			throw upstream();
		}
		boolean verified = user.path("verified").asBoolean(false);
		String email = Json.text(user.path("email"), "");
		String global = Json.text(user.path("global_name"), "");
		String name = global.isBlank() ? Json.text(user.path("username"), "") : global;
		return new SocialUser(
			id,
			verified && !email.isBlank() && email.length() <= 254 ? AccountService.normalize(email) : null,
			name.strip().length() > 30 ? name.strip().substring(0, 30) : name.strip());
	}
}
