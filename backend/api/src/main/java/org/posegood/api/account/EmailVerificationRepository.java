package org.posegood.api.account;

import java.time.Instant;
import java.util.List;

import org.posegood.api.common.KstTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * {@code email_verification_token}(V2.8 migration 019) 읽기·쓰기. 가입 전 6자리 코드 인증의 대기 상태다.
 *
 * 요청 번호(브라우저 HttpOnly 쿠키)와 코드(메일)의 원문은 저장하지 않고 SHA-256만 둔다. 계정이 아직 없어 주인은 정규화한 이메일이다.
 * 상태 변경은 모두 조건부 UPDATE라 동시 요청 중 하나만 통과한다(영향 행 1). 시각은 다른 표처럼 KST {@code DATETIME(3)}다({@link KstTime}).
 */
@Repository
public class EmailVerificationRepository {
	private final JdbcTemplate jdbc;

	public EmailVerificationRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 한 인증 요청. 확인·사용 상태는 담지 않는다 — 조건부 UPDATE가 그 시점의 행으로 판단한다. */
	public record Stored(long id, String email, String codeHash, Instant expiresAt) {
	}

	public void insert(String email, String tokenHash, String codeHash, Instant issuedAt, Instant expiresAt) {
		jdbc.update(
			"INSERT INTO email_verification_token(login_email,token_hash,code_hash,issued_at,expires_at)"
				+ " VALUES(?,?,?,?,?)",
			email, tokenHash, codeHash, KstTime.of(issuedAt), KstTime.of(expiresAt));
	}

	/** 그 이메일로 가장 최근에 보낸 요청의 발급 시각(재발송 간격 확인). 없으면 null. */
	public Instant lastIssued(String email) {
		List<Instant> rows = jdbc.query(
			"SELECT issued_at FROM email_verification_token WHERE login_email=? ORDER BY issued_at DESC LIMIT 1",
			(row, number) -> KstTime.read(row, "issued_at"), email);
		return rows.isEmpty() ? null : rows.get(0);
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

	/** 그 이메일의 남은 요청을 모두 쓴 것으로 만든다(새 요청 때 이전 코드와 확인 증명 무효). */
	public void consumeAll(String email, Instant at) {
		jdbc.update(
			"UPDATE email_verification_token SET consumed_at=? WHERE login_email=? AND consumed_at IS NULL",
			KstTime.of(at), email);
	}

	/** 만료 시각이 {@code before}보다 이른 행을 지운다. */
	public int purgeExpired(Instant before) {
		return jdbc.update("DELETE FROM email_verification_token WHERE expires_at < ?", KstTime.of(before));
	}
}
