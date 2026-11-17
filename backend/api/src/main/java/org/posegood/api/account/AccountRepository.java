package org.posegood.api.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/**
 * 계정 SQL 모음: user_account(계정·설정), local_credential(비밀번호), deletion_request(탈퇴),
 * refresh_token 철회(로그인 끊기).
 *
 * 식별 컬럼은 NOT NULL이다(CR-04). 탈퇴한 계정은 유예 기간(30일)에 그대로 두고, 최종 삭제는 Spark J3가 한다.
 * 비밀번호 해시는 V2.8부터 local_credential(T-54)에 있다. 행이 없으면 비밀번호 없는 계정(소셜 전용)이고,
 * 계정 행을 지우면 CASCADE(FK-31)로 함께 지워진다(계획 0096).
 * 로그인 끊기는 그 사용자의 refresh 토큰 철회로 한다(V2.6, ADR 0031).
 */
@Repository
public class AccountRepository {
	/** 계정과 비밀번호(없으면 NULL)를 함께 읽는다. */
	private static final String SELECT = "SELECT a.user_account_id, a.login_email, c.password_hash, a.display_name,"
		+ " a.age, a.occupation, a.account_status, a.threshold_policy_id, a.sound_alert_enabled"
		+ " FROM user_account a LEFT JOIN local_credential c ON c.user_account_id=a.user_account_id";

	private final JdbcTemplate jdbc;

	public AccountRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/**
	 * 이메일로 계정 조회(상태와 관계없이).
	 *
	 * CLOSED 계정으로 무엇을 할지는 호출한 쪽이 정한다.
	 */
	public Account findEmail(String email) {
		return first(
			jdbc.query(
				SELECT + " WHERE a.login_email=?",
				this::account,
				email));
	}

	/** ID로 계정 조회. */
	public Account find(long id) {
		return first(
			jdbc.query(
				SELECT + " WHERE a.user_account_id=?",
				this::account,
				id));
	}

	/**
	 * 가입: 계정 행 추가. 이미 있는 이메일이면 409.
	 *
	 * {@code hash}가 있으면 같은 트랜잭션에서 local_credential 행도 넣는다. 소셜 가입은 {@code null}(비밀번호 없음).
	 * 알림은 sound_alert_enabled의 기본값 true(켜짐)로 시작한다(V2.6, FE 화면 기본값).
	 * 가입 동의는 같은 트랜잭션 안에서 {@link ConsentRepository#insert}가 user_consent(T-41)에 저장한다.
	 * 호출한 쪽의 트랜잭션 안에서 실행한다.
	 */
	public long insert(String email, String hash, AccountContracts.Profile profile, long policy) {
		var key = new GeneratedKeyHolder();
		try {
			jdbc.update(
				connection -> {
					var insert = connection.prepareStatement(
						"INSERT INTO user_account(login_email,"
							+ "display_name,account_status,joined_at,"
							+ "threshold_policy_id,age,occupation)"
							+ " VALUES(?,?,'ACTIVE',?,?,?,?)",
						Statement.RETURN_GENERATED_KEYS);
					insert.setString(1, email);
					insert.setString(2, profile.name());
					insert.setObject(3, KstTime.now());
					insert.setLong(4, policy);
					insert.setObject(5, profile.age());
					insert.setString(6, profile.occupation());
					return insert;
				},
				key);
		} catch (DuplicateKeyException exists) {
			// UK-01은 탈퇴 유예 중인 계정의 이메일도 막는다.
			throw new ApiError(409, "ACCOUNT_EXISTS", "account cannot be registered");
		}
		long id = key.getKey().longValue();
		if (hash != null) {
			jdbc.update("INSERT INTO local_credential(user_account_id,password_hash) VALUES(?,?)", id, hash);
		}
		return id;
	}

	/**
	 * 설정 저장: 프로필, 판정 정책, 자세 알림.
	 *
	 * {@code alerts}는 DB V2.3에서 세션 알림의 원본인 sound_alert_enabled에 대응한다.
	 */
	public void updateSettings(long id, AccountContracts.Profile profile, long policy, boolean alerts) {
		jdbc.update(
			"UPDATE user_account SET display_name=?,age=?,occupation=?,threshold_policy_id=?,"
				+ "sound_alert_enabled=? WHERE user_account_id=? AND account_status='ACTIVE'",
			profile.name(),
			profile.age(),
			profile.occupation(),
			policy,
			alerts,
			id);
	}

	/**
	 * 이미 있는 비밀번호를 바꾼다(로그인 끊기는 removeLogins).
	 *
	 * 비밀번호 없는 계정(소셜 전용, local_credential 행 없음)에는 비밀번호를 새로 만들지 않는다. 부르는 쪽이 먼저
	 * {@link Account#hasPassword()}로 막는다. 그래도 바꾼 행이 없으면 조용히 성공한 것처럼 끝나지 않도록 예외를 던져
	 * 호출한 쪽의 트랜잭션(재설정 토큰 소비·로그인 끊기)을 되돌린다.
	 */
	public void changePassword(long id, String hash) {
		int changed = jdbc.update("UPDATE local_credential SET password_hash=? WHERE user_account_id=?", hash, id);
		if (changed != 1) {
			throw new IllegalStateException("account has no password to change");
		}
	}

	/**
	 * 탈퇴 접수: 삭제 요청 행 추가 + 계정 CLOSED.
	 *
	 * 호출한 쪽의 트랜잭션 안에서 실행한다(DB-04 6-1).
	 */
	public void close(long id, LocalDateTime at) {
		jdbc.update(
			"INSERT INTO deletion_request(user_account_id,requested_at,request_scope,"
				+ "request_status,account_closed_at) VALUES(?,?,'ACCOUNT_ALL','REQUESTED',?)",
			id,
			at,
			at);
		jdbc.update(
			"UPDATE user_account SET account_status='CLOSED' WHERE user_account_id=? AND"
				+ " account_status='ACTIVE'",
			id);
	}

	/**
	 * 그 사용자의 refresh 토큰을 모두 철회한다 = 모든 기기에서 로그인 유지를 끊는다(V2.6, ADR 0031).
	 *
	 * 이미 발급된 access 토큰은 만료(최대 30분)까지 남는다. 열린 실시간 연결은 {@code LoginsRemoved}로 바로 닫힌다.
	 */
	public void removeLogins(long id) {
		jdbc.update(
			"UPDATE refresh_token SET revoked_at=? WHERE user_account_id=? AND revoked_at IS NULL",
			KstTime.now(),
			id);
	}

	private Account account(ResultSet row, int rowNumber) throws SQLException {
		return new Account(
			row.getLong("user_account_id"),
			row.getString("login_email"),
			row.getString("password_hash"),
			new AccountContracts.Profile(
				row.getString("display_name"), row.getObject("age", Integer.class), row.getString("occupation")),
			"ACTIVE".equals(row.getString("account_status")),
			row.getLong("threshold_policy_id"),
			row.getBoolean("sound_alert_enabled"));
	}

	private static <T> T first(List<T> values) {
		return values.isEmpty() ? null : values.get(0);
	}

	/** 조회한 계정 한 행. {@code hash}는 비밀번호 없는 계정(소셜 전용)이면 {@code null}이다. */
	public record Account(
		long id,
		String email,
		String hash,
		AccountContracts.Profile profile,
		boolean active,
		long policyId,
		boolean alertsEnabled) {
		/** 비밀번호로 로그인할 수 있는 계정인가(local_credential 행이 있는가). */
		public boolean hasPassword() {
			return hash != null;
		}

		public AccountContracts.View view() {
			return new AccountContracts.View(Long.toString(id), email, profile, KstTime.today().toString());
		}
	}
}
