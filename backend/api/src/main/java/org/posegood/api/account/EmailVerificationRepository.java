package org.posegood.api.account;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

import org.posegood.api.common.Json;
import org.posegood.api.common.KstTime;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * {@code email_verification_token}(V2.8 migration 019) 읽기·쓰기. 가입 전 6자리 코드 인증의 대기 상태다.
 *
 * 요청 번호(브라우저 HttpOnly 쿠키)와 코드(메일)의 원문은 저장하지 않고 SHA-256만 둔다. 계정이 아직 없어 주인은 정규화한 이메일이다.
 * 상태 변경은 모두 조건부 UPDATE라 동시 요청 중 하나만 통과한다(영향 행 1). 시각은 다른 표처럼 KST {@code DATETIME(3)}다({@link KstTime}).
 *
 * <p>새 요청 저장({@link #reserve})과 매일 정리({@link #purgeExpired})는 READ COMMITTED로 돌린다. 이메일 칼럼에 인덱스가 없어
 * REPEATABLE READ(MySQL 기본)에서는 표 전체에 간격 잠금이 걸려, 빈 표에 동시에 들어온 첫 요청 두 개가 교착(1213)했다(PR #144 리뷰, 2026-11-23 재현).
 */
@Repository
public class EmailVerificationRepository {
	/** 같은 이메일 잠금({@code GET_LOCK})을 기다리는 최대 시간(초). 잠금은 DB 작업 몇 ms 동안만 잡는다. */
	static final int LOCK_WAIT_SECONDS = 5;

	private final JdbcTemplate jdbc;

	public EmailVerificationRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 한 인증 요청. 확인·사용 상태는 담지 않는다 — 조건부 UPDATE가 그 시점의 행으로 판단한다. */
	public record Stored(long id, String email, String codeHash, Instant expiresAt) {
	}

	/** {@link #reserve} 결과. */
	public enum Reserve {
		/** 저장했다(같은 이메일의 이전 요청은 무효). */
		RESERVED,
		/** 같은 이메일로 {@code notAfter} 뒤에 발급한 요청이 있다(재발송 간격 안). */
		TOO_SOON,
		/** 같은 이메일의 다른 요청이 잠금을 오래 쥐고 있다. */
		BUSY
	}

	/**
	 * 새 요청을 메일 발송 전에 저장한다. 같은 이메일은 DB 이름 잠금({@code GET_LOCK})으로 줄 세워
	 * 「재발송 간격 확인 → 이전 요청 무효 → 새 행」을 한 번에 하나만 한다. 잠금은 커밋한 뒤에 풀어서, 다음 요청은 이 행을 보고 간격 안이면
	 * {@link Reserve#TOO_SOON}을 받는다. 서버가 여러 대여도 같은 DB 잠금이라 맞다.
	 *
	 * <p>잠금·커밋·해제를 같은 연결에서 해야 해서 이 메서드는 자기 연결로 트랜잭션을 직접 연다. 바깥 트랜잭션 안에서 부르지 않는다.
	 *
	 * @param notAfter 이 시각 뒤에 발급한 같은 이메일 요청이 있으면 저장하지 않는다(발급 시각 - 재발송 간격)
	 */
	public Reserve reserve(String email, String tokenHash, String codeHash, Instant issuedAt, Instant expiresAt,
		Instant notAfter) {
		if (TransactionSynchronizationManager.isActualTransactionActive()) {
			throw new IllegalStateException("reserve opens its own transaction; call it outside a transaction");
		}
		return jdbc.execute((ConnectionCallback<Reserve>)con -> {
			String lock = lockName(email);
			if (!lock(con, lock)) {
				return Reserve.BUSY;
			}
			try {
				return inReadCommittedTransaction(con, () -> {
					if (countIssuedAfter(con, email, notAfter) > 0) {
						return Reserve.TOO_SOON;
					}
					update(con, "UPDATE email_verification_token SET consumed_at=?"
						+ " WHERE login_email=? AND consumed_at IS NULL", KstTime.of(issuedAt), email);
					update(con, "INSERT INTO email_verification_token"
						+ "(login_email,token_hash,code_hash,issued_at,expires_at) VALUES(?,?,?,?,?)",
						email, tokenHash, codeHash, KstTime.of(issuedAt), KstTime.of(expiresAt));
					return Reserve.RESERVED;
				});
			} finally {
				release(con, lock);
			}
		});
	}

	/** 메일 발송에 실패한 요청을 무효로 만든다. 재발송 간격의 기준으로는 남는다. */
	public void revoke(String tokenHash, Instant at) {
		jdbc.update("UPDATE email_verification_token SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL",
			KstTime.of(at), tokenHash);
	}

	/** 요청 번호 해시로 찾는다(없으면 null). 쓸 수 있는지는 아래 조건부 UPDATE가 판단한다. */
	public Stored find(String tokenHash) {
		List<Stored> rows = jdbc.query(
			"SELECT email_verification_token_id,login_email,code_hash,expires_at FROM email_verification_token"
				+ " WHERE token_hash=?",
			(row, number) -> new Stored(row.getLong("email_verification_token_id"), row.getString("login_email"),
				row.getString("code_hash"), KstTime.read(row, "expires_at")),
			tokenHash);
		return rows.isEmpty() ? null : rows.get(0);
	}

	/**
	 * 코드 확인 시도를 하나 센다. 확인 전·사용 전·만료 전이고 시도가 {@code limit}회 미만이면 1, 아니면 0.
	 * 코드를 비교하기 전에 세므로 맞든 틀리든 한 번으로 친다.
	 */
	public int attempt(long id, Instant at, int limit) {
		return jdbc.update(
			"UPDATE email_verification_token SET attempt_count=attempt_count+1 WHERE email_verification_token_id=?"
				+ " AND attempt_count<? AND verified_at IS NULL AND consumed_at IS NULL AND expires_at>?",
			id, limit, KstTime.of(at));
	}

	/** 코드가 맞았을 때 확인 시각을 남긴다. 확인 전·사용 전·만료 전이면 1, 아니면 0. */
	public int verify(long id, Instant at) {
		return jdbc.update(
			"UPDATE email_verification_token SET verified_at=? WHERE email_verification_token_id=?"
				+ " AND verified_at IS NULL AND consumed_at IS NULL AND expires_at>?",
			KstTime.of(at), id, KstTime.of(at));
	}

	/** 가입에 한 번만 쓴다. 확인했고 아직 쓰지 않았고 만료 전이면 1, 아니면 0(동시 요청 중 하나만 1). */
	public int consume(long id, Instant at) {
		return jdbc.update(
			"UPDATE email_verification_token SET consumed_at=? WHERE email_verification_token_id=?"
				+ " AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at>?",
			KstTime.of(at), id, KstTime.of(at));
	}

	/** 만료 시각이 {@code before}보다 이른 행을 지운다(READ COMMITTED — 새 요청 저장과 간격 잠금으로 엇갈리지 않게). */
	public int purgeExpired(Instant before) {
		if (TransactionSynchronizationManager.isActualTransactionActive()) {
			return jdbc.update("DELETE FROM email_verification_token WHERE expires_at < ?", KstTime.of(before));
		}
		Integer deleted = jdbc.execute((ConnectionCallback<Integer>)con -> inReadCommittedTransaction(con,
			() -> update(con, "DELETE FROM email_verification_token WHERE expires_at < ?", KstTime.of(before))));
		return deleted == null ? 0 : deleted;
	}

	/** 같은 이메일 요청을 줄 세우는 DB 이름 잠금 이름. MySQL 이름 한도(64자) 안이고 이메일 원문은 드러나지 않는다. */
	public static String lockName(String email) {
		return "posegood_ev_" + Json.sha256(email.getBytes(StandardCharsets.UTF_8)).substring(0, 48);
	}

	private interface SqlWork<T> {
		T run() throws SQLException;
	}

	/** 이 연결에서 READ COMMITTED 트랜잭션 하나를 열고 닫는다. 연결의 원래 설정은 되돌린다. */
	private static <T> T inReadCommittedTransaction(Connection con, SqlWork<T> work) throws SQLException {
		boolean autoCommit = con.getAutoCommit();
		int isolation = con.getTransactionIsolation();
		con.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
		con.setAutoCommit(false);
		try {
			T result = work.run();
			con.commit();
			return result;
		} catch (SQLException | RuntimeException failed) {
			con.rollback();
			throw failed;
		} finally {
			con.setAutoCommit(autoCommit);
			con.setTransactionIsolation(isolation);
		}
	}

	private static boolean lock(Connection con, String name) throws SQLException {
		try (var statement = con.prepareStatement("SELECT GET_LOCK(?, ?)")) {
			statement.setString(1, name);
			statement.setInt(2, LOCK_WAIT_SECONDS);
			try (var row = statement.executeQuery()) {
				return row.next() && row.getInt(1) == 1;
			}
		}
	}

	private static void release(Connection con, String name) throws SQLException {
		try (var statement = con.prepareStatement("SELECT RELEASE_LOCK(?)")) {
			statement.setString(1, name);
			statement.executeQuery().close();
		}
	}

	private static int countIssuedAfter(Connection con, String email, Instant after) throws SQLException {
		try (var statement = con.prepareStatement(
			"SELECT COUNT(*) FROM email_verification_token WHERE login_email=? AND issued_at>?")) {
			statement.setString(1, email);
			statement.setObject(2, KstTime.of(after));
			try (var row = statement.executeQuery()) {
				row.next();
				return row.getInt(1);
			}
		}
	}

	private static int update(Connection con, String sql, Object... values) throws SQLException {
		try (var statement = con.prepareStatement(sql)) {
			for (int i = 0; i < values.length; i++) {
				statement.setObject(i + 1, values[i]);
			}
			return statement.executeUpdate();
		}
	}
}
