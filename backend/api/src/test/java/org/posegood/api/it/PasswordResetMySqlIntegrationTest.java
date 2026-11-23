package org.posegood.api.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.ObjectMapper;

/**
 * 비밀번호 재설정(계획 0088)을 켠 API를 실제 MySQL(V2.7 {@code password_reset_token})로 확인하는 통합 시험.
 *
 * SMTP 대신 보낸 메일을 대기열에 담는 발송기를 쓴다(실제 메일 도착은 운영 확인 몫). 계정·주소는 모두 합성이다.
 * 출처별 요청 제한(15분에 5번)은 이 시험 문맥 전체가 127.0.0.1 하나로 나눠 쓰므로, 재설정 요청 경로는
 * {@link #mailedLinkResetsOnceAndEndsLogins} 한 곳에서만 부른다.
 * 실행: {@code backend/gradlew -p backend build -Pmysql-integration}(backend/README.md).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"server.address=127.0.0.1",
	"posegood.auth.password-reset.enabled=true",
	"posegood.auth.app-url=" + PasswordResetMySqlIntegrationTest.APP_URL,
	"posegood.auth.mail-from=no-reply@example.test",
	"spring.mail.host=smtp.example.invalid"})
@EnabledIfSystemProperty(named = "posegood.mysql.integration", matches = "true")
class PasswordResetMySqlIntegrationTest {
	static final String APP_URL = "https://app.example.test/";
	private static final ObjectMapper MAPPER = new ObjectMapper();
	private static final Pattern LINK = Pattern.compile(
		Pattern.quote(APP_URL) + "#password-reset\\?token=([A-Za-z0-9_-]{43})");
	private static final LinkedBlockingQueue<SimpleMailMessage> OUTBOX = new LinkedBlockingQueue<>();
	private static DisposableDatabase database;
	private static SyntheticInference inference;

	@LocalServerPort
	int port;

	/** 보낸 메일을 {@link #OUTBOX}에 담는다. 기본 SMTP 발송기는 이 빈이 있으면 만들어지지 않는다. */
	@TestConfiguration
	static class CapturedMail {
		@Bean
		@Primary
		JavaMailSender capturingMailSender() {
			return new JavaMailSenderImpl() {
				@Override
				public void send(SimpleMailMessage message) {
					OUTBOX.add(new SimpleMailMessage(message));
				}

				@Override
				public void send(SimpleMailMessage... messages) {
					for (var message : messages) {
						send(message);
					}
				}
			};
		}
	}

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws Exception {
		database = DisposableDatabase.create();
		inference = new SyntheticInference();
		registry.add("spring.datasource.url", database::url);
		registry.add("spring.datasource.username", database::user);
		registry.add("spring.datasource.password", database::password);
		registry.add("posegood.inference-url", inference::url);
	}

	@AfterAll
	static void cleanup() throws Exception {
		if (inference != null) {
			inference.close();
		}
		if (database != null) {
			database.close();
		}
	}

	private ApiClient client() {
		return new ApiClient("http://127.0.0.1:" + port);
	}

	private static String email() {
		return "reset-" + UUID.randomUUID() + "@example.invalid";
	}

	private ApiClient.Response requestReset(String email) throws Exception {
		return client().post("/auth/password-reset/requests", MAPPER.createObjectNode().put("email", email));
	}

	private ApiClient.Response confirm(String token, String password) throws Exception {
		return client().post("/auth/password-reset/confirm",
			MAPPER.createObjectNode().put("token", token).put("new_password", password));
	}

	/** 메일은 응답 뒤 작업 스레드가 보낸다: 받는 사람을 확인하고 링크의 토큰을 꺼낸다. */
	private static String nextToken(String to) throws InterruptedException {
		var mail = OUTBOX.poll(10, TimeUnit.SECONDS);
		assertNotNull(mail, "reset mail was not sent");
		assertEquals(to, mail.getTo()[0]);
		assertEquals("no-reply@example.test", mail.getFrom());
		var link = LINK.matcher(mail.getText());
		assertTrue(link.find(), "mail has no reset link");
		assertFalse(mail.getText().contains("synthetic-password"), "mail must not carry a password");
		return link.group(1);
	}

	private long userId(String email) throws SQLException {
		try (var connection = database.connect();
			var query = connection.prepareStatement("SELECT user_account_id FROM user_account WHERE login_email=?")) {
			query.setString(1, email);
			var row = query.executeQuery();
			assertTrue(row.next());
			return row.getLong(1);
		}
	}

	/** 그 계정의 재설정 토큰 수와 아직 쓸 수 있는(consumed_at NULL) 수. */
	private int[] tokens(long owner) throws SQLException {
		try (var connection = database.connect();
			var query = connection.prepareStatement(
				"SELECT COUNT(*),COALESCE(SUM(consumed_at IS NULL),0) FROM password_reset_token"
					+ " WHERE user_account_id=?")) {
			query.setLong(1, owner);
			var row = query.executeQuery();
			assertTrue(row.next());
			return new int[] {row.getInt(1), row.getInt(2)};
		}
	}

	@Test
	void mailedLinkResetsOnceAndEndsLogins() throws Exception {
		String first = email();
		String second = email();
		assertEquals(200, client().register(first).status());
		var stale = client();
		assertEquals(200, stale.login(first, "synthetic-password-1").status());
		var other = client();
		assertEquals(200, other.register(second).status());
		long firstId = userId(first);
		long secondId = userId(second);

		// ① 가입한 주소: 202 뒤 메일 한 통. DB에는 원문이 아니라 SHA-256만, 수명 30분.
		assertEquals(202, requestReset(first).status());
		String token = nextToken(first);
		try (var connection = database.connect();
			var query = connection.prepareStatement(
				"SELECT token_hash,issued_at,expires_at,consumed_at FROM password_reset_token"
					+ " WHERE user_account_id=?")) {
			query.setLong(1, firstId);
			var row = query.executeQuery();
			assertTrue(row.next());
			assertEquals(Json.sha256(token.getBytes(StandardCharsets.UTF_8)), row.getString(1));
			var issued = row.getObject(2, LocalDateTime.class);
			var expires = row.getObject(3, LocalDateTime.class);
			assertEquals(Duration.ofMinutes(30), Duration.between(issued, expires));
			// 발급 시각은 KST로 저장된다(9시간 어긋나지 않음).
			assertTrue(Duration.between(issued, KstTime.now()).abs().compareTo(Duration.ofMinutes(1)) < 0);
			assertNull(row.getObject(4));
			assertFalse(row.next());
		}

		// ② 없는 주소와 ③ 60초 안의 재요청도 같은 202지만 메일·토큰은 없다. 작업 스레드는 하나(순서대로)라서
		// ④ 다른 계정의 메일이 도착하면 앞의 두 요청은 이미 처리됐다.
		String unknown = email();
		assertEquals(202, requestReset(unknown).status());
		assertEquals(202, requestReset(first).status());
		assertEquals(202, requestReset(second).status());
		String secondToken = nextToken(second);
		assertTrue(OUTBOX.isEmpty());
		assertEquals(1, tokens(firstId)[0]);

		// ⑤ 출처 한도: 15분에 5번까지, 여섯 번째는 429.
		assertEquals(202, requestReset(unknown).status());
		assertEquals(429, requestReset(unknown).status());

		// 비밀번호 규칙을 어기면 400이고 토큰은 그대로 남는다.
		assertEquals(400, confirm(token, "short").status());
		assertEquals(1, tokens(firstId)[1]);
		// 완료: 204, 토큰 소비, 모든 로그인 철회, 자동 로그인 없음.
		var done = confirm(token, "synthetic-password-2");
		assertEquals(204, done.status());
		assertNull(done.body());
		assertEquals(0, tokens(firstId)[1]);
		try (var connection = database.connect();
			var query = connection.prepareStatement(
				"SELECT COUNT(*),SUM(revoked_at IS NULL) FROM refresh_token WHERE user_account_id=?")) {
			query.setLong(1, firstId);
			var row = query.executeQuery();
			assertTrue(row.next());
			assertTrue(row.getInt(1) >= 2);
			assertEquals(0, row.getInt(2));
		}
		assertEquals(401, stale.refresh().status());
		// 같은 링크는 한 번만: 다시 쓰면 410.
		assertEquals(410, confirm(token, "synthetic-password-3").status());
		assertEquals(401, client().login(first, "synthetic-password-1").status());
		assertEquals(200, client().login(first, "synthetic-password-2").status());

		// 비밀번호를 직접 바꾸면 남아 있던 재설정 링크도 무효(LoginsRemoved).
		assertEquals(1, tokens(secondId)[1]);
		var change = MAPPER.createObjectNode()
			.put("current_password", "synthetic-password-1")
			.put("new_password", "synthetic-password-2");
		assertEquals(204, other.put("/auth/password", change).status());
		assertEquals(0, tokens(secondId)[1]);
		assertEquals(410, confirm(secondToken, "synthetic-password-3").status());
		assertEquals(200, client().login(second, "synthetic-password-2").status());
	}

	/** 저장한 KST 만료 시각을 그대로 비교한다: 지난 링크는 410, 남은 링크는 성공. 시간대가 어긋나면 둘 중 하나가 틀린다. */
	@Test
	void storedKstExpiryIsHonoured() throws Exception {
		String email = email();
		assertEquals(200, client().register(email).status());
		long owner = userId(email);
		String expired = "expired-" + UUID.randomUUID();
		String live = "live-" + UUID.randomUUID();
		var now = KstTime.now();
		try (var connection = database.connect();
			var insert = connection.prepareStatement(
				"INSERT INTO password_reset_token (user_account_id,token_hash,issued_at,expires_at)"
					+ " VALUES (?,?,?,?)")) {
			insert.setLong(1, owner);
			insert.setString(2, Json.sha256(expired.getBytes(StandardCharsets.UTF_8)));
			insert.setObject(3, now.minusMinutes(31));
			insert.setObject(4, now.minusMinutes(1));
			insert.executeUpdate();
			insert.setString(2, Json.sha256(live.getBytes(StandardCharsets.UTF_8)));
			insert.setObject(3, now.minusMinutes(25));
			insert.setObject(4, now.plusMinutes(5));
			insert.executeUpdate();
		}
		assertEquals(410, confirm(expired, "synthetic-password-2").status());
		assertEquals(410, confirm("never-issued-" + UUID.randomUUID(), "synthetic-password-2").status());
		assertEquals(204, confirm(live, "synthetic-password-2").status());
		assertEquals(200, client().login(email, "synthetic-password-2").status());
	}
}
