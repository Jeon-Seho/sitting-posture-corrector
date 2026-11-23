package org.posegood.api.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mockito.ArgumentCaptor;
import org.posegood.api.account.PasswordResetMailer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 실제 HTTP·쿠키·MySQL 트랜잭션. 발송 업체만 mock하며 합성 이메일만 쓴다. */
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
