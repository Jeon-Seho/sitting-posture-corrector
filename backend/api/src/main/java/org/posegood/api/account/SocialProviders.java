package org.posegood.api.account;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.posegood.api.common.ApiError;
import org.springframework.stereotype.Component;

/**
 * 소셜 로그인 제공자 목록. 화면에 보이는 순서대로 {@link #KNOWN}을 두고, 어댑터가 있고 설정이 켜진 것만 쓸 수 있다.
 * 지금 어댑터는 Discord뿐이다. Kakao·Google·GitHub는 목록에만 있어 상태 응답에서 {@code available=false}로 나온다.
 */
@Component
public class SocialProviders {
	/** 화면 순서. DB {@code social_identity.provider} CHECK 목록과 같게 유지한다(대문자). */
	public static final List<String> KNOWN = List.of("discord", "kakao", "google", "github");

	private final Map<String, SocialProviderClient> clients = new LinkedHashMap<>();

	public SocialProviders(List<SocialProviderClient> adapters) {
		for (var adapter : adapters) {
			if (!KNOWN.contains(adapter.id())) {
				throw new IllegalStateException("unknown social provider adapter: " + adapter.id());
			}
			clients.put(adapter.id(), adapter);
		}
	}

	/** 켜진 제공자. 모르거나 꺼져 있으면 404 {@code SOCIAL_DISABLED}. */
	public SocialProviderClient require(String id) {
		var client = id == null ? null : clients.get(id);
		if (client == null || !client.enabled()) {
			throw new ApiError(404, "SOCIAL_DISABLED", "this social sign-in is not configured");
		}
		return client;
	}

	/** 켜져 있는가(모르면 false). */
	public boolean enabled(String id) {
		var client = clients.get(id);
		return client != null && client.enabled();
	}

	/** 하나라도 켜졌는가. 꺼져 있으면 {@code social_identity} 표를 읽지 않는다. */
	public boolean anyEnabled() {
		return clients.values().stream().anyMatch(SocialProviderClient::enabled);
	}

	/** DB 코드(DISCORD …) → 주소 ID(discord …). */
	public static String idOf(String code) {
		return code.toLowerCase(java.util.Locale.ROOT);
	}
}
