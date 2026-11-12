package org.posegood.api.account;

import java.net.URI;

/**
 * 소셜 로그인 제공자 하나(Discord·Kakao·Google·GitHub …)의 연결 어댑터.
 *
 * <p>공통 규칙(대기 상태, 자동 연결 금지, 가입·연결·해제)은 {@link SocialLoginService}가 맡고, 어댑터는 제공자마다 다른
 * 두 가지만 한다: 동의 화면 주소 만들기, 인가 코드를 사용자로 바꾸기. 새 제공자는 이 인터페이스를 구현한 {@code @Component}와
 * 설정값만 더하면 된다(경로·DB 코드는 그대로).
 */
public interface SocialProviderClient {
	/** 주소에 쓰는 소문자 ID(예: {@code discord}). {@link SocialProviders#KNOWN} 중 하나. */
	String id();

	/** DB {@code social_identity.provider} 값(예: {@code DISCORD}). */
	default String code() {
		return id().toUpperCase(java.util.Locale.ROOT);
	}

	/** 설정이 채워져 켜졌는가. */
	boolean enabled();

	/** 브라우저를 보낼 동의 화면 주소(state·PKCE S256 challenge 포함). */
	URI authorizeUrl(String state, String codeChallenge);

	/** 인가 코드를 제공자 사용자로 바꾼다. 실패하면 502 {@code SOCIAL_UPSTREAM}. */
	SocialUser exchange(String code, String codeVerifier);

	/**
	 * 제공자 사용자 중 쓰는 값. {@code subject}는 제공자가 주는 바뀌지 않는 사용자 ID, {@code email}은 제공자가 확인한 주소일
	 * 때만 채운다(아니면 null). {@code name}은 가입 화면 이름 제안값이다(저장하지 않음).
	 */
	record SocialUser(String subject, String email, String name) {
	}
}
