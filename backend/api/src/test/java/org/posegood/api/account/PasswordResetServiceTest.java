package org.posegood.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.posegood.api.common.ApiError;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/** 비밀번호 재설정 규칙(합성 값만 사용). 실제 표는 MySQL 통합 시험 대상이다. */
class PasswordResetServiceTest {
	private static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z");
	private static final AccountContracts.Profile PROFILE = new AccountContracts.Profile("시험", null, null);

	private PasswordResetRepository resets;
	private AccountRepository accounts;
	private AccountService accountService;
	private PasswordResetMailer mailer;
	private ApplicationEventPublisher events;
	private PasswordResetService service;

	/** 받은 일을 바로 실행한다(응답 뒤 처리를 시험에서 기다리지 않게). */
	private static final class Inline extends AbstractExecutorService {
		@Override
		public void execute(Runnable command) {
			command.run();
		}

		@Override
		public void shutdown() {
		}

		@Override
		public java.util.List<Runnable> shutdownNow() {
			return java.util.List.of();
		}

		@Override
		public boolean isShutdown() {
			return false;
		}

		@Override
		public boolean isTerminated() {
			return false;
		}

		@Override
		public boolean awaitTermination(long timeout, TimeUnit unit) {
			return true;
		}
	}

	@BeforeEach
	@SuppressWarnings("unchecked")
	void setUp() {
		resets = mock(PasswordResetRepository.class);
		accounts = mock(AccountRepository.class);
		accountService = mock(AccountService.class);
		mailer = mock(PasswordResetMailer.class);
		events = mock(ApplicationEventPublisher.class);
		var tx = mock(TransactionTemplate.class);
		org.mockito.Mockito.doAnswer(call -> {
			((Consumer<TransactionStatus>)call.getArgument(0)).accept(null);
			return null;
		}).when(tx).executeWithoutResult(any());
		service = new PasswordResetService(
			new PasswordResetService.Settings(true, "https://app.example.test/", Duration.ofMinutes(30),
				Duration.ofSeconds(60)),
			resets, accounts, accountService, new RequestLimiter(Clock.fixed(NOW, ZoneOffset.UTC)), mailer,
			new UserLocks(), tx, events, Clock.fixed(NOW, ZoneOffset.UTC), new Inline());
	}

	private static AccountRepository.Account account(long id, boolean active) {
		return new AccountRepository.Account(id, "user@example.test", "$2a$hash", PROFILE, active, 1, true);
	}

	@Test
	void aKnownEmailGetsAOneTimeLinkAndNoPassword() {
		when(accounts.findEmail("user@example.test")).thenReturn(account(4, true));
		service.request("  User@Example.test ", "203.0.113.1");
		var hash = ArgumentCaptor.forClass(String.class);
		verify(resets).consumeAll(4L, NOW);
		verify(resets).insert(eq(4L), hash.capture(), eq(NOW), eq(NOW.plus(Duration.ofMinutes(30))));
		var link = ArgumentCaptor.forClass(String.class);
		verify(mailer).sendReset(eq("user@example.test"), link.capture(), eq(30L));
		assertTrue(link.getValue().startsWith("https://app.example.test/#password-reset?token="));
		String token = link.getValue().substring(link.getValue().indexOf("token=") + 6);
		// DB에는 원문이 아니라 해시만 간다.
		assertEquals(PasswordResetService.hash(token), hash.getValue());
		assertFalse(hash.getValue().contains(token));
	}

	@Test
	void unknownClosedAndRecentRequestsLookTheSameAndSendNothing() {
		when(accounts.findEmail("closed@example.test")).thenReturn(account(5, false));
		when(accounts.findEmail("recent@example.test")).thenReturn(account(6, true));
		when(resets.lastIssued(6L)).thenReturn(NOW.minusSeconds(10));
		service.request("nobody@example.test", "203.0.113.2");
		service.request("closed@example.test", "203.0.113.3");
		service.request("recent@example.test", "203.0.113.4");
		verify(resets, never()).insert(anyLong(), anyString(), any(), any());
		verify(mailer, never()).sendReset(anyString(), anyString(), anyLong());
	}

	@Test
	void oneClientIsLimited() {
		for (int i = 0; i < RequestLimiter.LIMIT; i++) {
			service.request("nobody@example.test", "203.0.113.9");
		}
		var error = assertThrows(ApiError.class, () -> service.request("nobody@example.test", "203.0.113.9"));
		assertEquals(429, error.status());
	}

	@Test
	void aMailFailureDoesNotChangeTheAnswer() {
		when(accounts.findEmail("user@example.test")).thenReturn(account(4, true));
		org.mockito.Mockito.doThrow(new org.springframework.mail.MailSendException("down"))
			.when(mailer).sendReset(anyString(), anyString(), anyLong());
		service.request("user@example.test", "203.0.113.1");
	}

	@Test
	void confirmConsumesOnceChangesThePasswordAndEndsEveryLogin() {
		var stored = new PasswordResetRepository.Stored(11, 4, NOW.plusSeconds(60), null);
		when(resets.find(PasswordResetService.hash("tok"))).thenReturn(stored);
		when(accounts.find(4L)).thenReturn(account(4, true));
		when(resets.consume(11L, NOW)).thenReturn(1);
		service.confirm("tok", "a-new-password-123");
		verify(accountService).applyResetPassword(4L, "a-new-password-123");
		verify(resets).consumeAll(4L, NOW);
		verify(events).publishEvent(new AccountService.LoginsRemoved(4L));
	}

	@Test
	void aRaceLoserOrUsedOrExpiredTokenIsInvalid() {
		when(accounts.find(4L)).thenReturn(account(4, true));
		when(resets.find(PasswordResetService.hash("race")))
			.thenReturn(new PasswordResetRepository.Stored(11, 4, NOW.plusSeconds(60), null));
		when(resets.consume(11L, NOW)).thenReturn(0);
		when(resets.find(PasswordResetService.hash("used")))
			.thenReturn(new PasswordResetRepository.Stored(12, 4, NOW.plusSeconds(60), NOW.minusSeconds(1)));
		when(resets.find(PasswordResetService.hash("old")))
			.thenReturn(new PasswordResetRepository.Stored(13, 4, NOW, null));
		for (var token : new String[] {"race", "used", "old", "unknown"}) {
			var error = assertThrows(ApiError.class, () -> service.confirm(token, "a-new-password-123"));
			assertEquals("RESET_TOKEN_INVALID", error.code());
		}
		verify(accountService, never()).applyResetPassword(anyLong(), anyString());
	}

	@Test
	void aShortPasswordIsRejectedBeforeTheToken() {
		var error = assertThrows(ApiError.class, () -> service.confirm("tok", "short"));
		assertEquals("INVALID_PASSWORD", error.code());
		verify(resets, never()).find(anyString());
	}

	@Test
	void endingLoginsElsewhereVoidsOpenLinks() {
		service.loginsRemoved(new AccountService.LoginsRemoved(4L));
		verify(resets).consumeAll(4L, NOW);
	}
}
