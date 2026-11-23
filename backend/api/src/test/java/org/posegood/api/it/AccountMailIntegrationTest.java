package org.posegood.api.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mockito.ArgumentCaptor;
import org.posegood.api.account.EmailVerificationRepository;
import org.posegood.api.account.EmailVerificationService;
import org.posegood.api.account.PasswordResetMailer;
import org.posegood.api.common.ApiError;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 실제 HTTP·쿠키·MySQL 트랜잭션. 발송 업체만 mock하며 합성 이메일만 쓴다.
 * 가입 인증은 출처(IP)별 15분 5회 제한이 있어 이 클래스 전체에서 인증 요청을 5번 넘게 보내지 않는다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
	"server.address=127.0.0.1", "posegood.auth.email-verification.enabled=true",
	"posegood.auth.password-reset.enabled=true", "posegood.auth.app-url=https://app.example.test/"})
@EnabledIfSystemProperty(named = "posegood.mysql.integration", matches = "true")
class AccountMailIntegrationTest {
	private static DisposableDatabase database;
	@LocalServerPort
	int port;
	@MockitoBean
	PasswordResetMailer mailer;
	@Autowired
	JdbcTemplate jdbc;
	@Autowired
	EmailVerificationService verification;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws Exception {
		database = DisposableDatabase.create();
		registry.add("spring.datasource.url", database::url);
		registry.add("spring.datasource.username", database::user);
		registry.add("spring.datasource.password", database::password);
	}

	@AfterAll
	static void cleanup() throws Exception {
		if (database != null) {
			database.close();
		}
	}

	private ApiClient client() {
		return new ApiClient("http://127.0.0.1:" + port);
	}

	@Test
	void registrationRequiresVerifiedMatchingEmailInTheSameBrowser() throws Exception {
		var api = client();
		String email = "mail-it-" + UUID.randomUUID() + "@example.invalid";
		assertEquals(410, api.register(email).status());
		assertEquals(202, api.post("/auth/email-verification/requests", Map.of("email", email)).status());
		var code = ArgumentCaptor.forClass(String.class);
		verify(mailer).sendVerification(eq(email), code.capture(), eq(15L));
		assertEquals(410, client().post("/auth/email-verification/confirm",
			Map.of("token", code.getValue())).status());
		assertEquals(204, api.post("/auth/email-verification/confirm",
			Map.of("token", code.getValue())).status());
		assertEquals(410, api.register("another-" + email).status());
		assertEquals(200, api.register(email).status());
		assertEquals(410, api.register(email).status());
		assertEquals(1, jdbc.queryForObject(
			"SELECT COUNT(*) FROM user_account WHERE login_email=?", Integer.class, email));
	}

	@Test
	void codeStateLivesInTheTableAndFailedRegistrationKeepsTheProof() throws Exception {
		String email = "dup-it-" + UUID.randomUUID() + "@example.invalid";
		var first = client();
		first.post("/auth/email-verification/requests", Map.of("email", email));
		var codes = ArgumentCaptor.forClass(String.class);
		verify(mailer).sendVerification(eq(email), codes.capture(), eq(15L));
		assertEquals(204, first.post("/auth/email-verification/confirm", Map.of("token", codes.getValue())).status());
		assertEquals(200, first.register(email).status());
		// 같은 이메일 재발송 간격(60초)을 지난 것으로 만든다.
		jdbc.update("UPDATE email_verification_token SET issued_at=issued_at - INTERVAL 2 MINUTE WHERE login_email=?",
			email);

		var second = client();
		assertEquals(202, second.post("/auth/email-verification/requests", Map.of("email", email)).status());
		verify(mailer, times(2)).sendVerification(eq(email), codes.capture(), eq(15L));
		String code = codes.getValue();
		String wrong = code.equals("000000") ? "000001" : "000000";
		assertEquals(410, second.post("/auth/email-verification/confirm", Map.of("token", wrong)).status());
		var row = jdbc.queryForMap("SELECT code_hash,attempt_count,verified_at,consumed_at"
			+ " FROM email_verification_token WHERE login_email=? AND consumed_at IS NULL", email);
		assertEquals(64, row.get("code_hash").toString().length());
		assertNotEquals(code, row.get("code_hash"));
		assertEquals(1, ((Number)row.get("attempt_count")).intValue());
		assertNull(row.get("verified_at"));
		assertEquals(204, second.post("/auth/email-verification/confirm", Map.of("token", code)).status());

		var exists = second.register(email);
		assertEquals(409, exists.status());
		assertEquals("ACCOUNT_EXISTS", exists.body().get("code").asString());
		row = jdbc.queryForMap("SELECT attempt_count,verified_at,consumed_at FROM email_verification_token"
			+ " WHERE login_email=? ORDER BY issued_at DESC LIMIT 1", email);
		assertEquals(2, ((Number)row.get("attempt_count")).intValue());
		assertNotNull(row.get("verified_at"));
		assertNull(row.get("consumed_at"), "failed registration must roll back the proof consumption");
		assertEquals(1, jdbc.queryForObject(
			"SELECT COUNT(*) FROM email_verification_token WHERE login_email=? AND consumed_at IS NOT NULL",
			Integer.class, email));
	}

	/** 출처별 제한(15분 5회)을 피하려고 HTTP 대신 서비스를 직접 부르고 출처 이름을 나눈다. 시작 신호에 맞춰 함께 부른다. */
	private List<String> concurrently(List<String> emails) throws Exception {
		var results = Collections.synchronizedList(new ArrayList<String>());
		var start = new CountDownLatch(1);
		var threads = new ArrayList<Thread>();
		for (int i = 0; i < emails.size(); i++) {
			String email = emails.get(i);
			String client = "it-concurrent-" + UUID.randomUUID();
			var thread = new Thread(() -> {
				try {
					start.await();
					verification.request(email, client);
					results.add("202");
				} catch (ApiError error) {
					results.add(String.valueOf(error.status()));
				} catch (Exception other) {
					results.add(other.getClass().getSimpleName() + ": " + other.getMessage());
				}
			});
			threads.add(thread);
			thread.start();
		}
		start.countDown();
		for (var thread : threads) {
			thread.join(30_000);
		}
		return results;
	}

	/** PR #144 리뷰 2번: REPEATABLE READ에서는 빈 표에 동시에 들어온 첫 요청이 교착(1213)했다. */
	@Test
	void concurrentFirstRequestsOnAnEmptyTableNeverDeadlock() throws Exception {
		jdbc.update("DELETE FROM email_verification_token");
		var emails = new ArrayList<String>();
		for (int i = 0; i < 8; i++) {
			emails.add("empty-it-" + i + "-" + UUID.randomUUID() + "@example.invalid");
		}
		assertEquals(Collections.nCopies(8, "202"), concurrently(emails));
		assertEquals(8, jdbc.queryForObject(
			"SELECT COUNT(*) FROM email_verification_token WHERE consumed_at IS NULL", Integer.class));
	}

	/** PR #144 리뷰 1번: 메일이 느린 동안 같은 이메일로 온 요청은 저장된 행을 보고 429, 메일은 한 통. 잠금은 남지 않는다. */
	@Test
	void concurrentRequestsForTheSameEmailSendOneMail() throws Exception {
		String email = "same-it-" + UUID.randomUUID() + "@example.invalid";
		org.mockito.Mockito.doAnswer(call -> {
			Thread.sleep(1000);
			return null;
		}).when(mailer).sendVerification(eq(email), org.mockito.ArgumentMatchers.anyString(),
			org.mockito.ArgumentMatchers.anyLong());
		var results = concurrently(List.of(email, email, email));
		assertEquals(List.of("202", "429", "429"), results.stream().sorted().toList());
		verify(mailer, times(1)).sendVerification(eq(email), org.mockito.ArgumentMatchers.anyString(), eq(15L));
		assertEquals(1, jdbc.queryForObject(
			"SELECT COUNT(*) FROM email_verification_token WHERE login_email=?", Integer.class, email));
		assertNull(jdbc.queryForObject("SELECT IS_USED_LOCK(?)", Long.class,
			EmailVerificationRepository.lockName(email)));
	}

	@Test
	void reusedPasswordRollsBackTokenConsumptionAndSuccessfulResetRevokesRefresh() throws Exception {
		var api = client();
		String email = "reset-it-" + UUID.randomUUID() + "@example.invalid";
		api.post("/auth/email-verification/requests", Map.of("email", email));
		var code = ArgumentCaptor.forClass(String.class);
		verify(mailer).sendVerification(eq(email), code.capture(), eq(15L));
		api.post("/auth/email-verification/confirm", Map.of("token", code.getValue()));
		assertEquals(200, api.register(email).status());
		assertEquals(202, api.post("/auth/password-reset/requests", Map.of("email", email)).status());
		var link = ArgumentCaptor.forClass(String.class);
		verify(mailer, timeout(5000)).sendReset(eq(email), link.capture(), eq(30L));
		String token = link.getValue().substring(link.getValue().indexOf("token=") + 6);
		assertEquals(204, api.post("/auth/password-reset/validate", Map.of("token", token)).status());
		var reused = api.post("/auth/password-reset/confirm",
			Map.of("token", token, "new_password", "synthetic-password-1"));
		assertEquals(400, reused.status());
		assertEquals("PASSWORD_REUSED", reused.body().get("code").asString());
		assertEquals(204, api.post("/auth/password-reset/validate", Map.of("token", token)).status());
		assertEquals(204, api.post("/auth/password-reset/confirm",
			Map.of("token", token, "new_password", "synthetic-password-2")).status());
		assertEquals(410, api.post("/auth/password-reset/confirm",
			Map.of("token", token, "new_password", "synthetic-password-3")).status());
		assertEquals(401, api.refresh().status());
		assertEquals(401, client().login(email, "synthetic-password-1").status());
		assertEquals(200, client().login(email, "synthetic-password-2").status());
	}
}
