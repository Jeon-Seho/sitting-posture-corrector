package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.posegood.api.common.ApiError;

/** 합성 주소·코드만 사용. 실제 메일 발송은 SMTP 통합 점검 대상이다. */
class EmailVerificationServiceTest {
	private static final Instant NOW = Instant.parse("2026-11-16T01:00:00Z");
	private PasswordResetMailer mailer;
	private Clock clock;
	private EmailVerificationService service;

	@BeforeEach
	void setUp() {
		mailer = mock(PasswordResetMailer.class);
		clock = mock(Clock.class);
		when(clock.instant()).thenReturn(NOW);
		service = new EmailVerificationService(true, mailer, new RequestLimiter(clock), clock);
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
	void expiryAndServerRestartRequireAnotherCode() {
		String id = service.request("new@example.test", "client");
		String code = code();
		when(clock.instant()).thenReturn(NOW.plusSeconds(900));
		assertThrows(ApiError.class, () -> service.confirm(id, code));
		var restarted = new EmailVerificationService(true, mailer, new RequestLimiter(clock), clock);
		assertThrows(ApiError.class, () -> restarted.confirm(id, code));
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
	void smtpFailureIsReportedAsUnavailable() {
		doThrow(new IllegalStateException("synthetic SMTP failure"))
			.when(mailer).sendVerification(anyString(), anyString(), anyLong());
		assertEquals(503, assertThrows(ApiError.class,
			() -> service.request("new@example.test", "client")).status());
	}
}
