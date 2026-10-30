package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;

/** 로그인 토큰(ADR 0031): access 발급·확인, refresh 교체·유예·재사용 감지·만료·철회. DB는 메모리 가짜. */
class AuthTokensTest {
	private static final Instant T0 = Instant.parse("2026-10-27T01:00:00Z");
	private static final String SECRET = "synthetic-test-secret-at-least-32-bytes-long";

	private final FakeRefreshTokens rows = new FakeRefreshTokens();
	private final AccountService accounts = mock(AccountService.class);
	private Instant now = T0;

	private AuthTokens tokens() {
		Clock clock = new Clock() {
			@Override
			public java.time.ZoneId getZone() {
				return ZoneOffset.UTC;
			}

			@Override
			public Clock withZone(java.time.ZoneId zone) {
				return this;
			}

			@Override
			public Instant instant() {
				return now;
			}
		};
		return new AuthTokens(rows, accounts, AuthTokens.key(SECRET), Duration.ofMinutes(30), Duration.ofDays(14),
			Duration.ofSeconds(30), clock);
	}

	@Test
	void signInIssuesAnAccessTokenForTheAccountAndStoresOnlyTheRefreshHash() {
		now = Instant.now(); // JWT 만료 확인은 실제 시계를 쓴다
		var issued = tokens().signIn(7);
		assertEquals(1800, issued.expiresIn());
		var principal = (AccountPrincipal)tokens().authenticate(issued.accessToken()).getPrincipal();
		assertEquals(7, principal.id());
		assertEquals(1, rows.all.size());
		assertEquals(AuthTokens.hash(issued.refreshToken()), rows.all.get(0).hash);
		assertNotEquals(issued.refreshToken(), rows.all.get(0).hash);
	}

	@Test
	void accessTokensAreRejectedWhenForgedExpiredOrMissing() {
		now = Instant.now();
		var issued = tokens().signIn(7);
		var other = new AuthTokens(rows, accounts, AuthTokens.key("another-synthetic-secret-at-least-32-bytes"),
			Duration.ofMinutes(30), Duration.ofDays(14), Duration.ofSeconds(30), Clock.systemUTC());
		assertEquals(401, assertThrows(ApiError.class, () -> other.authenticate(issued.accessToken())).status());
		assertEquals(401, assertThrows(ApiError.class, () -> tokens().authenticate("")).status());
		assertEquals(401, assertThrows(ApiError.class, () -> tokens().authenticate(null)).status());
		// 만료(30분 + 확인 여유 60초) 뒤 — 검증기는 실제 시계를 쓰므로 과거에 발급한 토큰으로 확인한다.
		now = Instant.now().minus(Duration.ofHours(1));
		var old = tokens().signIn(7);
		assertEquals(401, assertThrows(ApiError.class, () -> tokens().authenticate(old.accessToken())).status());
	}

	@Test
	void refreshRotatesTheTokenAndTheOldOneWorksOnlyWithinTheGrace() {
		var first = tokens().signIn(7);
		now = T0.plus(Duration.ofMinutes(29));
		var second = tokens().refresh(first.refreshToken());
		assertEquals(7, second.owner());
		assertNotEquals(first.refreshToken(), second.refreshToken());
		assertNotNull(rows.find(AuthTokens.hash(first.refreshToken())).rotatedAt());

		// 다른 탭이 같은 옛 토큰으로 동시에 갱신: 유예(30초) 안이면 새 토큰을 하나 더 준다.
		now = now.plusSeconds(30);
		assertEquals(7, tokens().refresh(first.refreshToken()).owner());
		// 유예 뒤 재사용: 탈취로 보고 그 사용자의 토큰을 모두 철회한다.
		now = now.plusSeconds(1);
		assertEquals(401, assertThrows(ApiError.class, () -> tokens().refresh(first.refreshToken())).status());
		assertTrue(rows.all.stream().allMatch(row -> row.revokedAt != null));
		assertEquals(401, assertThrows(ApiError.class, () -> tokens().refresh(second.refreshToken())).status());
	}

	@Test
	void refreshFailsWhenUnknownExpiredRevokedOrTheAccountIsClosed() {
		var tokens = tokens();
		assertEquals(401, assertThrows(ApiError.class, () -> tokens.refresh(null)).status());
		assertEquals(401, assertThrows(ApiError.class, () -> tokens.refresh("unknown")).status());

		var expiring = tokens.signIn(7);
		now = T0.plus(Duration.ofDays(14));
		assertEquals(401, assertThrows(ApiError.class, () -> tokens.refresh(expiring.refreshToken())).status());

		now = T0;
		var loggedOut = tokens.signIn(7);
		tokens.signOut(loggedOut.refreshToken());
		assertEquals(401, assertThrows(ApiError.class, () -> tokens.refresh(loggedOut.refreshToken())).status());
		tokens.signOut("unknown"); // 모르는 토큰 로그아웃은 조용히 넘어간다

		var closed = tokens.signIn(8);
		when(accounts.requireActive(8)).thenThrow(new ApiError(401, "UNAUTHENTICATED", "authentication required"));
		assertEquals(401, assertThrows(ApiError.class, () -> tokens.refresh(closed.refreshToken())).status());
		assertNull(rows.find(AuthTokens.hash(closed.refreshToken())).rotatedAt());
	}

	@Test
	void theSigningKeyMustBeLongEnough() {
		assertThrows(IllegalStateException.class, () -> AuthTokens.key("short"));
		assertNotNull(AuthTokens.key("")); // 비어 있으면 실행마다 무작위 키(로컬 개발용)
	}

	/** {@code refresh_token} 테이블 대신 쓰는 메모리 목록. */
	private static final class FakeRefreshTokens extends RefreshTokenRepository {
		private final List<Row> all = new ArrayList<>();

		FakeRefreshTokens() {
			super(null);
		}

		private static final class Row {
			long id;
			long owner;
			String hash;
			Instant issuedAt;
			Instant expiresAt;
			Instant rotatedAt;
			Instant revokedAt;

			Stored stored() {
				return new Stored(id, owner, issuedAt, expiresAt, rotatedAt, revokedAt);
			}
		}

		@Override
		public void insert(long owner, String hash, Instant issuedAt, Instant expiresAt) {
			var row = new Row();
			row.id = all.size() + 1;
			row.owner = owner;
			row.hash = hash;
			row.issuedAt = issuedAt;
			row.expiresAt = expiresAt;
			all.add(row);
		}

		@Override
		public Stored find(String hash) {
			return all.stream().filter(row -> row.hash.equals(hash)).findFirst().map(Row::stored).orElse(null);
		}

		@Override
		public void markRotated(long id, Instant at) {
			all.stream().filter(row -> row.id == id && row.rotatedAt == null).forEach(row -> row.rotatedAt = at);
		}

		@Override
		public void revoke(long id, Instant at) {
			all.stream().filter(row -> row.id == id && row.revokedAt == null).forEach(row -> row.revokedAt = at);
		}

		@Override
		public void revokeAll(long owner, Instant at) {
			all.stream().filter(row -> row.owner == owner && row.revokedAt == null).forEach(row -> row.revokedAt = at);
		}

		@Override
		public int purgeExpired(Instant before) {
			int size = all.size();
			all.removeIf(row -> row.expiresAt.isBefore(before));
			return size - all.size();
		}
	}
}
