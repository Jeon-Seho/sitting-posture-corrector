package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.posegood.api.common.ApiError;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

/** 합성 주소·코드만 사용. 표의 조건부 UPDATE는 아래 가짜 저장소가 흉내 내고, 실제 표는 MySQL 통합 시험 대상이다. */
class EmailVerificationServiceTest {
	private static final Instant NOW = Instant.parse("2026-11-16T01:00:00Z");
	private PasswordResetMailer mailer;
	private Clock clock;
	private Rows rows;
	private TransactionTemplate tx;
	private EmailVerificationService service;

	/** {@code email_verification_token} 한 행. */
	private static final class Row {
		long id;
		String email;
		String tokenHash;
		String codeHash;
		int attempts;
		Instant issued;
		Instant expires;
		Instant verified;
		Instant consumed;

		Row copy() {
			var copy = new Row();
			copy.id = id;
			copy.email = email;
			copy.tokenHash = tokenHash;
			copy.codeHash = codeHash;
			copy.attempts = attempts;
			copy.issued = issued;
			copy.expires = expires;
			copy.verified = verified;
			copy.consumed = consumed;
			return copy;
		}
	}

	/** 저장소의 SQL 조건을 메모리에서 그대로 따른다. */
	private static final class Rows extends EmailVerificationRepository {
		List<Row> rows = new ArrayList<>();

		Rows() {
			super(null);
		}

		@Override
		public void insert(String email, String tokenHash, String codeHash, Instant issuedAt, Instant expiresAt) {
			var row = new Row();
			row.id = rows.size() + 1;
			row.email = email;
			row.tokenHash = tokenHash;
			row.codeHash = codeHash;
			row.issued = issuedAt;
			row.expires = expiresAt;
			rows.add(row);
		}

		@Override
		public Instant lastIssued(String email) {
			return rows.stream().filter(row -> row.email.equals(email)).map(row -> row.issued)
				.max(Instant::compareTo).orElse(null);
		}

		@Override
		public Stored find(String tokenHash) {
			return rows.stream().filter(row -> row.tokenHash.equals(tokenHash)).findFirst()
				.map(row -> new Stored(row.id, row.email, row.codeHash, row.expires)).orElse(null);
		}

		private Row open(long id, Instant at) {
			var row = rows.stream().filter(value -> value.id == id).findFirst().orElseThrow();
			return row.consumed == null && at.isBefore(row.expires) ? row : null;
		}

		@Override
		public int attempt(long id, Instant at, int limit) {
			var row = open(id, at);
			if (row == null || row.verified != null || row.attempts >= limit) {
				return 0;
			}
			row.attempts++;
			return 1;
		}

		@Override
		public int verify(long id, Instant at) {
			var row = open(id, at);
			if (row == null || row.verified != null) {
				return 0;
			}
			row.verified = at;
			return 1;
		}

		@Override
		public int consume(long id, Instant at) {
			var row = open(id, at);
			if (row == null || row.verified == null) {
				return 0;
			}
			row.consumed = at;
			return 1;
		}

		@Override
		public void consumeAll(String email, Instant at) {
			rows.stream().filter(row -> row.email.equals(email) && row.consumed == null)
				.forEach(row -> row.consumed = at);
		}

		@Override
		public int purgeExpired(Instant before) {
			int size = rows.size();
			rows.removeIf(row -> row.expires.isBefore(before));
			return size - rows.size();
		}
	}

	@BeforeEach
	void setUp() {
		mailer = mock(PasswordResetMailer.class);
		clock = mock(Clock.class);
		when(clock.instant()).thenReturn(NOW);
		rows = new Rows();
		// 실패하면 행을 되돌린다(DB 트랜잭션 롤백 흉내).
		tx = new TransactionTemplate() {
			@Override
			public <T> T execute(TransactionCallback<T> action) {
				var before = rows.rows.stream().map(Row::copy).toList();
				try {
					return action.doInTransaction(null);
				} catch (RuntimeException failed) {
					rows.rows = new ArrayList<>(before);
					throw failed;
				}
			}
		};
		service = new EmailVerificationService(true, rows, mailer, new RequestLimiter(clock), tx, clock);
	}

	private String code() {
		var code = ArgumentCaptor.forClass(String.class);
		verify(mailer).sendVerification(eq("new@example.test"), code.capture(), eq(15L));
		return code.getValue();
	}

	@Test
	void normalizedEmailAndSixDigitCodeAreBoundToTheBrowserAndConsumedOnce() {
		String id = service.request(" New@Example.test ", "client");
		String code = code();
		assertEquals(true, code.matches("[0-9]{6}"));
		assertThrows(ApiError.class, () -> service.confirm("another-browser", code));
		service.confirm(id, code);
		assertThrows(ApiError.class, () -> service.register(id, "other@example.test", () -> "bad"));
		assertEquals("created", service.register(id, "NEW@example.test", () -> "created"));
		assertThrows(ApiError.class, () -> service.register(id, "new@example.test", () -> "twice"));
	}

	@Test
	void onlyHashesAreStored() {
		String id = service.request("new@example.test", "client");
		String code = code();
		var row = rows.rows.get(0);
		assertEquals("new@example.test", row.email);
		assertEquals(64, row.tokenHash.length());
		assertEquals(64, row.codeHash.length());
		assertFalse(row.tokenHash.contains(id));
		assertFalse(row.codeHash.contains(code));
	}

	@Test
	void unverifiedOrMissingProofCannotRegister() {
		String id = service.request("new@example.test", "client");
		assertThrows(ApiError.class, () -> service.register(id, "new@example.test", () -> "bad"));
		assertThrows(ApiError.class, () -> service.register(null, "new@example.test", () -> "bad"));
	}

	@Test
	void fiveWrongAttemptsInvalidateEvenTheCorrectCode() {
		String id = service.request("new@example.test", "client");
		String code = code();
		for (int i = 0; i < 5; i++) {
			assertThrows(ApiError.class, () -> service.confirm(id, "wrong"));
		}
		assertEquals(5, rows.rows.get(0).attempts);
		assertThrows(ApiError.class, () -> service.confirm(id, code));
	}

	@Test
	void confirmedCodeCannotBeConfirmedAgain() {
		String id = service.request("new@example.test", "client");
		String code = code();
		service.confirm(id, code);
		assertThrows(ApiError.class, () -> service.confirm(id, code));
	}

	@Test
	void resendIsLimitedByEmailEvenFromAnotherClientAndRevokesOldProof() {
		String id = service.request("new@example.test", "client");
		service.confirm(id, code());
		assertEquals(429, assertThrows(ApiError.class,
			() -> service.request("new@example.test", "other-client")).status());
		when(clock.instant()).thenReturn(NOW.plusSeconds(60));
		service.request("new@example.test", "other-client");
		assertThrows(ApiError.class, () -> service.register(id, "new@example.test", () -> "bad"));
	}

	@Test
	void serverRestartKeepsThePendingCodeButExpiryDoesNot() {
		String id = service.request("new@example.test", "client");
		String code = code();
		var restarted = new EmailVerificationService(true, rows, mailer, new RequestLimiter(clock), tx, clock);
		restarted.confirm(id, code);
		when(clock.instant()).thenReturn(NOW.plusSeconds(900));
		assertThrows(ApiError.class, () -> restarted.register(id, "new@example.test", () -> "late"));
	}

	@Test
	void expiredCodeIsRejected() {
		String id = service.request("new@example.test", "client");
		String code = code();
		when(clock.instant()).thenReturn(NOW.plusSeconds(900));
		assertThrows(ApiError.class, () -> service.confirm(id, code));
	}

	@Test
	void failedRegistrationLeavesProofAvailableForRetry() {
		String id = service.request("new@example.test", "client");
		service.confirm(id, code());
		assertThrows(IllegalStateException.class, () -> service.register(id, "new@example.test", () -> {
			throw new IllegalStateException("synthetic database failure");
		}));
		assertEquals("retry", service.register(id, "new@example.test", () -> "retry"));
	}

	@Test
	void smtpFailureIsReportedAsUnavailableAndStoresNothing() {
		doThrow(new IllegalStateException("synthetic SMTP failure"))
			.when(mailer).sendVerification(anyString(), anyString(), anyLong());
		assertEquals(503, assertThrows(ApiError.class,
			() -> service.request("new@example.test", "client")).status());
		assertTrue(rows.rows.isEmpty());
	}

	@Test
	void dailyPurgeRemovesRowsExpiredForADay() {
		service.request("new@example.test", "client");
		when(clock.instant()).thenReturn(NOW.plusSeconds(900).plusSeconds(86_400));
		service.purgeExpired();
		assertEquals(1, rows.rows.size());
		when(clock.instant()).thenReturn(NOW.plusSeconds(901).plusSeconds(86_400));
		service.purgeExpired();
		assertTrue(rows.rows.isEmpty());
	}

	@Test
	void disabledVerificationRegistersWithoutProofAndRejectsRequests() {
		var disabled = new EmailVerificationService(false, rows, mailer, new RequestLimiter(clock), tx, clock);
		assertEquals("created", disabled.register(null, "new@example.test", () -> "created"));
		assertEquals(404, assertThrows(ApiError.class,
			() -> disabled.request("new@example.test", "client")).status());
	}
}
