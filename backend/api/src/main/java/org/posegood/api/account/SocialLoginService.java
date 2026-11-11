package org.posegood.api.account;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 소셜 로그인·가입·계정 연결 공통 규칙(제공자와 무관). 제공자마다 다른 부분은 {@link SocialProviderClient} 어댑터가 한다.
 *
 * <ul>
 * <li>로그인: 연결된 계정이 있으면 그 계정으로 로그인한다.</li>
 * <li>연결이 없고 Discord가 확인한 이메일이 기존 계정과 같으면 자동으로 묶지 않는다({@code link-required}).
 * 이메일만으로 묶으면 제공자 쪽 이메일을 가로챈 사람이 기존 계정에 들어올 수 있다. 사용자가 비밀번호로 로그인한 뒤
 * 설정에서 직접 연결한다.</li>
 * <li>연결도 기존 계정도 없으면 가입 대기를 만들고 앱의 약관·프로필 화면으로 보낸다. Discord에 확인된 이메일이 없으면
 * 가입하지 않는다({@code email-required}).</li>
 * <li>연결: 로그인한 사용자가 시작하고, 콜백에서 그 사용자에게 Discord 사용자를 붙인다.</li>
 * <li>해제: 비밀번호가 없는 계정의 마지막 로그인 수단이면 막는다(409 {@code LAST_LOGIN_METHOD}).</li>
 * </ul>
 */
@Service
public class SocialLoginService {
	private static final Logger log = LoggerFactory.getLogger(SocialLoginService.class);

	private final SocialProviders providers;
	private final SocialPending pending;
	private final SocialIdentityRepository identities;
	private final AccountRepository accounts;
	private final AccountService accountService;
	private final UserLocks locks;

	public SocialLoginService(
		SocialProviders providers,
		SocialPending pending,
		SocialIdentityRepository identities,
		AccountRepository accounts,
		AccountService accountService,
		UserLocks locks) {
		this.providers = providers;
		this.pending = pending;
		this.identities = identities;
		this.accounts = accounts;
		this.accountService = accountService;
		this.locks = locks;
	}

	/** 시작 결과: 브라우저를 보낼 주소와 쿠키에 담을 대기 ID. */
	public record Started(URI authorizeUrl, String pendingId) {
	}

	/**
	 * 콜백 결과. {@code status}는 앱 주소 조각({@code #social-result?status=})에 그대로 쓰는 값이다.
	 * {@code signedIn}은 로그인한 계정 ID(로그인 성공일 때만), {@code signupId}는 가입 대기 ID(가입이 필요할 때만).
	 */
	public record Outcome(String status, Long signedIn, String signupId) {
		static Outcome of(String status) {
			return new Outcome(status, null, null);
		}
	}

	/** 제공자가 하나라도 켜졌는가. */
	public boolean enabled() {
		return providers.anyEnabled();
	}

	/** 로그인(또는 가입)을 시작한다. 꺼진 제공자면 404. */
	public Started startLogin(String provider) {
		return start(providers.require(provider), null);
	}

	/** 로그인한 사용자의 제공자 연결을 시작한다. 이미 연결돼 있으면 409. */
	public Started startLink(String provider, long user) {
		var client = providers.require(provider);
		accountService.requireActive(user);
		if (identities.links(user).stream().anyMatch(link -> client.code().equals(link.provider()))) {
			throw new ApiError(409, "SOCIAL_ALREADY_LINKED", "this provider is already linked");
		}
		return start(client, user);
	}

	private Started start(SocialProviderClient client, Long linkUser) {
		String state = SocialPending.random();
		String verifier = SocialPending.random();
		String id = pending.putAuthorization(new SocialPending.Authorization(client.id(), state, verifier, linkUser));
		return new Started(client.authorizeUrl(state, challenge(verifier)), id);
	}

	/**
	 * 제공자에서 돌아온 요청을 처리한다. 예외 대신 결과 상태로 알린다(브라우저는 앱으로 돌아가야 하므로).
	 *
	 * @param provider 주소의 제공자 ID(시작한 제공자와 다르면 만료로 본다)
	 * @param pendingId 쿠키의 대기 ID
	 * @param state 주소의 state
	 * @param code 주소의 인가 코드(취소하면 null)
	 * @param error 주소의 오류(취소하면 {@code access_denied})
	 */
	public Outcome callback(String provider, String pendingId, String state, String code, String error) {
		if (provider == null || !providers.enabled(provider)) {
			return Outcome.of("failed");
		}
		var client = providers.require(provider);
		var started = pending.takeAuthorization(pendingId);
		if (started == null || !provider.equals(started.provider())
			|| state == null || !constantEquals(started.state(), state)) {
			return Outcome.of("expired");
		}
		if (error != null || code == null || code.isBlank() || code.length() > 512) {
			return Outcome.of("cancelled");
		}
		SocialProviderClient.SocialUser user;
		try {
			user = client.exchange(code, started.codeVerifier());
		} catch (ApiError upstream) {
			log.warn("{} code exchange failed", client.id());
			return Outcome.of("failed");
		}
		return started.linkUser() == null ? login(client, user) : link(client, started.linkUser(), user);
	}

	private Outcome login(SocialProviderClient client, SocialProviderClient.SocialUser user) {
		Long owner = identities.owner(client.code(), user.subject());
		if (owner != null) {
			var account = accounts.find(owner);
			if (account == null) {
				return Outcome.of("failed");
			}
			return account.active() ? new Outcome("signed-in", owner, null) : Outcome.of("closed");
		}
		if (user.email() == null) {
			return Outcome.of("email-required");
		}
		var existing = accounts.findEmail(user.email());
		if (existing != null) {
			return Outcome.of(existing.active() ? "link-required" : "closed");
		}
		String signup = pending.putSignup(new SocialPending.Signup(client.id(), user.subject(), user.email(), user.name()));
		return new Outcome("signup", null, signup);
	}

	private Outcome link(SocialProviderClient client, long owner, SocialProviderClient.SocialUser user) {
		return locks.withLock(owner, () -> {
			var account = accounts.find(owner);
			if (account == null || !account.active()) {
				return Outcome.of("failed");
			}
			Long current = identities.owner(client.code(), user.subject());
			if (current != null) {
				return Outcome.of(current == owner ? "linked" : "in-use");
			}
			try {
				identities.insert(owner, client.code(), user.subject());
			} catch (ApiError duplicate) {
				return Outcome.of("in-use");
			}
			return Outcome.of("linked");
		});
	}

	/** 가입 대기의 제안값(이메일·이름). 없거나 만료면 404. */
	public SocialPending.Signup signupDraft(String signupId) {
		var draft = pending.peekSignup(signupId);
		if (draft == null || !providers.enabled(draft.provider())) {
			throw signupExpired();
		}
		return draft;
	}

	/** 가입 완료: 대기를 소비하고 비밀번호 없는 계정 + 제공자 연결을 만든다. */
	public AccountRepository.Account signup(
		String signupId, AccountContracts.Profile profile, List<AccountContracts.Consent> consents) {
		// 동의를 먼저 확인해 잘못된 입력으로 대기를 잃지 않게 한다.
		ConsentRepository.validate(consents, profile);
		var draft = pending.takeSignup(signupId);
		if (draft == null || !providers.enabled(draft.provider())) {
			throw signupExpired();
		}
		return accountService.registerSocial(
			draft.email(), profile, consents, providers.require(draft.provider()).code(), draft.subject(), identities);
	}

	/**
	 * 연결 상태. 제공자는 화면 순서({@link SocialProviders#KNOWN}) 그대로, 꺼진 것은 {@code available=false}.
	 * 모두 꺼져 있으면 표를 읽지 않는다(DB에 표가 아직 없을 수 있다).
	 */
	public AccountContracts.SocialStatus status(long user) {
		var account = accountService.requireActive(user);
		var linkedAt = new HashMap<String, String>();
		if (providers.anyEnabled()) {
			for (var link : identities.links(user)) {
				linkedAt.put(SocialProviders.idOf(link.provider()), link.linkedAt() == null ? "" : link.linkedAt().toString());
			}
		}
		var list = SocialProviders.KNOWN.stream()
			.map(id -> new AccountContracts.SocialProvider(id, providers.enabled(id), linkedAt.containsKey(id),
				linkedAt.getOrDefault(id, "").isEmpty() ? null : linkedAt.get(id)))
			.toList();
		return new AccountContracts.SocialStatus(AccountService.hasPassword(account), list);
	}

	/** 제공자 연결 해제. 비밀번호도 다른 연결도 없으면 마지막 로그인 수단이라 막는다. */
	public void unlink(String provider, long user) {
		var client = providers.require(provider);
		locks.run(user, () -> {
			var account = accountService.requireActive(user);
			boolean otherLink = identities.links(user).stream().anyMatch(link -> !client.code().equals(link.provider()));
			if (!AccountService.hasPassword(account) && !otherLink) {
				throw new ApiError(409, "LAST_LOGIN_METHOD",
					"set a password with a password reset email before unlinking the only sign-in method");
			}
			if (identities.delete(user, client.code()) == 0) {
				throw new ApiError(404, "SOCIAL_NOT_LINKED", "this provider is not linked");
			}
		});
	}

	private static ApiError signupExpired() {
		return new ApiError(410, "SOCIAL_SIGNUP_EXPIRED", "social sign-up expired; start again");
	}

	static String challenge(String verifier) {
		byte[] digest = java.util.HexFormat.of().parseHex(Json.sha256(verifier.getBytes(StandardCharsets.US_ASCII)));
		return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
	}

	private static boolean constantEquals(String expected, String actual) {
		return java.security.MessageDigest.isEqual(
			expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
	}
}
