package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;

import tools.jackson.databind.json.JsonMapper;

/** Discord 로그인·가입·연결 규칙(합성 값만 사용). DB는 흉내 낸다 — 실제 표는 MySQL 통합 시험 대상이다. */
class SocialLoginServiceTest {
	private static final String DISCORD_ID = "100000000000000001";
	private static final AccountContracts.Profile PROFILE = new AccountContracts.Profile("시험", null, null);

	private DiscordClient discord;
	private SocialPending pending;
	private SocialIdentityRepository identities;
	private AccountRepository accounts;
	private AccountService accountService;
	private SocialLoginService social;

	@BeforeEach
	void setUp() {
		discord = mock(DiscordClient.class);
		when(discord.enabled()).thenReturn(true);
		when(discord.id()).thenReturn("discord");
		when(discord.code()).thenReturn("DISCORD");
		when(discord.authorizeUrl(anyString(), anyString())).thenReturn(URI.create("https://discord.test/authorize"));
		identities = mock(SocialIdentityRepository.class);
		// 실제 저장소처럼 연결이 없으면 null(모의 객체의 기본값 0이 아님).
		when(identities.owner(anyString(), anyString())).thenReturn(null);
		pending = new SocialPending();
		accounts = mock(AccountRepository.class);
		accountService = mock(AccountService.class);
		social = new SocialLoginService(new SocialProviders(List.of(discord)), pending, identities, accounts, accountService, new UserLocks());
	}

	private static AccountRepository.Account account(long id, boolean active, String hash) {
		return new AccountRepository.Account(id, "user" + id + "@example.test", hash, PROFILE, active, 1, true);
	}

	/** 시작 후 Discord가 돌려보낸 것처럼 콜백을 부른다. */
	private SocialLoginService.Outcome roundTrip(SocialLoginService.Started started, SocialProviderClient.SocialUser user) {
		var stored = pending.takeAuthorization(started.pendingId());
		String id = pending.putAuthorization(stored);
		when(discord.exchange(eq("code-1"), eq(stored.codeVerifier()))).thenReturn(user);
		return social.callback("discord", id, stored.state(), "code-1", null);
	}

	@Test
	void aLinkedDiscordUserSignsIn() {
		when(identities.owner(SocialIdentityRepository.DISCORD, DISCORD_ID)).thenReturn(7L);
		when(accounts.find(7L)).thenReturn(account(7, true, "$2a$hash"));
		var outcome = roundTrip(social.startLogin("discord"), new SocialProviderClient.SocialUser(DISCORD_ID, null, "디코"));
		assertEquals("signed-in", outcome.status());
		assertEquals(7L, outcome.signedIn());
	}

	@Test
	void aClosedAccountDoesNotSignIn() {
		when(identities.owner(SocialIdentityRepository.DISCORD, DISCORD_ID)).thenReturn(7L);
		when(accounts.find(7L)).thenReturn(account(7, false, "$2a$hash"));
		var outcome = roundTrip(social.startLogin("discord"), new SocialProviderClient.SocialUser(DISCORD_ID, null, "디코"));
		assertEquals("closed", outcome.status());
		assertNull(outcome.signedIn());
	}

	@Test
	void aMatchingEmailIsNeverLinkedAutomatically() {
		when(accounts.findEmail("same@example.test")).thenReturn(account(3, true, "$2a$hash"));
		var outcome = roundTrip(social.startLogin("discord"),
			new SocialProviderClient.SocialUser(DISCORD_ID, "same@example.test", "디코"));
		assertEquals("link-required", outcome.status());
		assertNull(outcome.signedIn());
		verify(identities, never()).insert(anyLong(), anyString(), anyString());
	}

	@Test
	void withoutAVerifiedEmailThereIsNoSignup() {
		var outcome = roundTrip(social.startLogin("discord"), new SocialProviderClient.SocialUser(DISCORD_ID, null, "디코"));
		assertEquals("email-required", outcome.status());
	}

	@Test
	void aNewDiscordUserGetsASignupThatCanBeUsedOnce() {
		var outcome = roundTrip(social.startLogin("discord"),
			new SocialProviderClient.SocialUser(DISCORD_ID, "new@example.test", "디코"));
		assertEquals("signup", outcome.status());
		assertEquals("new@example.test", social.signupDraft(outcome.signupId()).email());
		var consents = List.of(new AccountContracts.Consent("C1", "v1"));
		when(accountService.registerSocial(eq("new@example.test"), eq(PROFILE), any(), eq("DISCORD"),
			eq(DISCORD_ID), eq(identities))).thenReturn(account(9, true, AccountService.NO_PASSWORD));
		// ConsentRepository.validate는 실제 규칙이라 필수 동의가 모자라면 대기를 쓰지 않고 거절한다.
		assertThrows(ApiError.class, () -> social.signup(outcome.signupId(), PROFILE, consents));
		assertEquals("new@example.test", social.signupDraft(outcome.signupId()).email());

		var valid = ConsentRepository.REQUIRED.stream()
			.map(type -> new AccountContracts.Consent(type, ConsentRepository.VERSION))
			.toList();
		assertEquals(9L, social.signup(outcome.signupId(), PROFILE, valid).id());
		var reused = assertThrows(ApiError.class, () -> social.signup(outcome.signupId(), PROFILE, valid));
		assertEquals("SOCIAL_SIGNUP_EXPIRED", reused.code());
	}

	@Test
	void aWrongStateOrReusedPendingIdExpires() {
		var started = social.startLogin("discord");
		assertEquals("expired", social.callback("discord", started.pendingId(), "wrong", "code-1", null).status());
		// 한 번 꺼낸 대기는 다시 쓸 수 없다.
		assertEquals("expired", social.callback("discord", started.pendingId(), "wrong", "code-1", null).status());
		assertEquals("expired", social.callback("discord", null, "x", "code-1", null).status());
	}

	@Test
	void cancellingAtDiscordIsReported() {
		var started = social.startLogin("discord");
		var stored = pending.takeAuthorization(started.pendingId());
		String id = pending.putAuthorization(stored);
		assertEquals("cancelled", social.callback("discord", id, stored.state(), null, "access_denied").status());
	}

	@Test
	void linkingAttachesToTheSignedInUserOnly() {
		when(accountService.requireActive(5L)).thenReturn(account(5, true, "$2a$hash"));
		when(accounts.find(5L)).thenReturn(account(5, true, "$2a$hash"));
		var outcome = roundTrip(social.startLink("discord", 5L), new SocialProviderClient.SocialUser(DISCORD_ID, null, "디코"));
		assertEquals("linked", outcome.status());
		assertNull(outcome.signedIn());
		verify(identities).insert(5L, SocialIdentityRepository.DISCORD, DISCORD_ID);
	}

	@Test
	void aDiscordUserLinkedElsewhereIsInUse() {
		when(accountService.requireActive(5L)).thenReturn(account(5, true, "$2a$hash"));
		when(accounts.find(5L)).thenReturn(account(5, true, "$2a$hash"));
		when(identities.owner(SocialIdentityRepository.DISCORD, DISCORD_ID)).thenReturn(6L);
		var outcome = roundTrip(social.startLink("discord", 5L), new SocialProviderClient.SocialUser(DISCORD_ID, null, "디코"));
		assertEquals("in-use", outcome.status());
		verify(identities, never()).insert(anyLong(), anyString(), anyString());
	}

	@Test
	void theOnlySignInMethodCannotBeUnlinked() {
		when(accountService.requireActive(5L)).thenReturn(account(5, true, AccountService.NO_PASSWORD));
		var error = assertThrows(ApiError.class, () -> social.unlink("discord", 5L));
		assertEquals("LAST_LOGIN_METHOD", error.code());
		verify(identities, never()).delete(anyLong(), anyString());
	}

	@Test
	void whenDiscordIsOffTheTableIsNotRead() {
		when(discord.enabled()).thenReturn(false);
		when(accountService.requireActive(5L)).thenReturn(account(5, true, "$2a$hash"));
		var status = social.status(5L);
		assertTrue(status.passwordSet());
		assertEquals(false, status.providers().get(0).available());
		verify(identities, never()).links(anyLong());
		assertEquals("SOCIAL_DISABLED", assertThrows(ApiError.class, () -> social.startLogin("discord")).code());
	}

	@Test
	void statusListsEveryPlannedProviderInScreenOrder() {
		when(accountService.requireActive(5L)).thenReturn(account(5, true, "$2a$hash"));
		when(identities.links(5L)).thenReturn(List.of(new SocialIdentityRepository.Link(5, "DISCORD", null)));
		var providers = social.status(5L).providers();
		assertEquals(List.of("discord", "kakao", "google", "github"),
			providers.stream().map(AccountContracts.SocialProvider::provider).toList());
		assertTrue(providers.get(0).available());
		assertTrue(providers.get(0).linked());
		// 어댑터가 없는 제공자는 준비 중(available=false)이고 시작할 수 없다.
		assertFalse(providers.get(1).available());
		assertEquals("SOCIAL_DISABLED", assertThrows(ApiError.class, () -> social.startLogin("kakao")).code());
		assertEquals("SOCIAL_DISABLED", assertThrows(ApiError.class, () -> social.startLogin("unknown")).code());
	}

	@Test
	void aCallbackOnAnotherProviderPathIsExpired() {
		var started = social.startLogin("discord");
		var stored = pending.takeAuthorization(started.pendingId());
		String id = pending.putAuthorization(new SocialPending.Authorization("kakao", stored.state(), stored.codeVerifier(), null));
		assertEquals("expired", social.callback("discord", id, stored.state(), "code-1", null).status());
	}

	@Test
	void anotherLinkedProviderAllowsUnlinkWithoutPassword() {
		when(accountService.requireActive(5L)).thenReturn(account(5, true, AccountService.NO_PASSWORD));
		when(identities.links(5L)).thenReturn(List.of(
			new SocialIdentityRepository.Link(5, "DISCORD", null), new SocialIdentityRepository.Link(5, "GOOGLE", null)));
		when(identities.delete(5L, "DISCORD")).thenReturn(1);
		social.unlink("discord", 5L);
		verify(identities).delete(5L, "DISCORD");
	}

	@Test
	void pkceChallengeIsBase64UrlOfSha256() throws Exception {
		String verifier = "synthetic-verifier-0123456789-abcdefghijklmnopqrstu";
		byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
			.digest(verifier.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
		assertEquals(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest),
			SocialLoginService.challenge(verifier));
		assertFalse(SocialLoginService.challenge(verifier).contains("="));
	}

	@Test
	void discordUserKeepsOnlyAVerifiedEmail() {
		var mapper = JsonMapper.builder().build();
		var verified = DiscordClient.parseUser(mapper.readTree(
			"{\"id\":\"" + DISCORD_ID + "\",\"username\":\"u\",\"global_name\":\"이름\","
				+ "\"email\":\"A@Example.test\",\"verified\":true}"));
		assertEquals("a@example.test", verified.email());
		assertEquals("이름", verified.name());
		var unverified = DiscordClient.parseUser(mapper.readTree(
			"{\"id\":\"" + DISCORD_ID + "\",\"username\":\"u\",\"email\":\"a@example.test\",\"verified\":false}"));
		assertNull(unverified.email());
		assertEquals("u", unverified.name());
		assertThrows(ApiError.class, () -> DiscordClient.parseUser(mapper.readTree("{\"id\":\"x\"}")));
	}
}
