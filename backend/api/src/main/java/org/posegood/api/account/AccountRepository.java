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
 * 계정 SQL 모음: user_account(계정·설정), deletion_request(탈퇴), refresh_token 철회(로그인 끊기).
 *
 * 식별 컬럼은 NOT NULL이다(CR-04). 탈퇴한 계정은 유예 기간(30일)에 그대로 두고, 최종 삭제는 Spark J3가 한다.
 * 로그인 끊기는 그 사용자의 refresh 토큰 철회로 한다(V2.6, ADR 0031).
 */
@Repository
public class AccountRepository {
	private static final String COLUMNS = "user_account_id, login_email, password_hash, display_name,"
		+ "age, occupation, account_status, threshold_policy_id,sound_alert_enabled";

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
				"SELECT " + COLUMNS + " FROM user_account WHERE login_email=?",
				this::account,
				email));
	}

	/** ID로 계정 조회. */
	public Account find(long id) {
		return first(
			jdbc.query(
				"SELECT " + COLUMNS + " FROM user_account WHERE user_account_id=?",
				this::account,
				id));
	}

	/**
	 * 가입: 계정 행 추가. 이미 있는 이메일이면 409.
	 *
	 * 알림은 sound_alert_enabled의 기본값 true(켜짐)로 시작한다(V2.6, FE 화면 기본값).
	 * 동의 테이블(T-41)이 보류라 가입 동의는 저장하지 않는다.
	 */
	public long insert(String email, String hash, AccountContracts.Profile profile, long policy) {
		var key = new GeneratedKeyHolder();
		try {
			jdbc.update(
				connection -> {
					var insert = connection.prepareStatement(
						"INSERT INTO user_account(login_email,password_hash,"
							+ "display_name,account_status,joined_at,"
							+ "threshold_policy_id,age,occupation)"
							+ " VALUES(?,?,?,'ACTIVE',?,?,?,?)",
						Statement.RETURN_GENERATED_KEYS);
					insert.setString(1, email);
					insert.setString(2, hash);
					insert.setString(3, profile.name());
					insert.setObject(4, KstTime.now());
					insert.setLong(5, policy);
					insert.setObject(6, profile.age());
					insert.setString(7, profile.occupation());
					return insert;
				},
				key);
		} catch (DuplicateKeyException exists) {
			// UK-01은 탈퇴 유예 중인 계정의 이메일도 막는다.
			throw new ApiError(409, "ACCOUNT_EXISTS", "account cannot be registered");
		}
		return key.getKey().longValue();
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

	/** 비밀번호 해시만 바꾼다(로그인 끊기는 removeLogins). */
	public void changePassword(long id, String hash) {
		jdbc.update("UPDATE user_account SET password_hash=? WHERE user_account_id=?", hash, id);
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

	/** 조회한 계정 한 행. */
	public record Account(
		long id,
		String email,
		String hash,
		AccountContracts.Profile profile,
		boolean active,
		long policyId,
		boolean alertsEnabled) {
		public AccountContracts.View view() {
			return new AccountContracts.View(Long.toString(id), email, profile, KstTime.today().toString());
		}
	}
}
