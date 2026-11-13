package org.posegood.api.account;

import java.time.Instant;
import java.util.List;

import org.posegood.api.common.KstTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * {@code password_reset_token}(제안 V2.7, DB 담당 적용 전) 읽기·쓰기. 토큰 원문은 메일 링크에만 있고 DB에는 SHA-256만 둔다.
 *
 * 시각은 다른 표처럼 KST {@code DATETIME(3)}다({@link KstTime}).
 */
@Repository
public class PasswordResetRepository {
	private final JdbcTemplate jdbc;

	public PasswordResetRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 한 토큰. 아직 쓰지 않았으면 {@code consumedAt}이 null이다. */
	public record Stored(long id, long owner, Instant expiresAt, Instant consumedAt) {
	}

	public void insert(long owner, String hash, Instant issuedAt, Instant expiresAt) {
		jdbc.update(
			"INSERT INTO password_reset_token(user_account_id,token_hash,issued_at,expires_at) VALUES(?,?,?,?)",
			owner, hash, KstTime.of(issuedAt), KstTime.of(expiresAt));
	}

	/** 그 사용자가 가장 최근에 받은 토큰의 발급 시각(재발송 간격 확인). 없으면 null. */
	public Instant lastIssued(long owner) {
		List<Instant> rows = jdbc.query(
			"SELECT issued_at FROM password_reset_token WHERE user_account_id=? ORDER BY issued_at DESC LIMIT 1",
			(row, number) -> KstTime.read(row, "issued_at"), owner);
		return rows.isEmpty() ? null : rows.get(0);
	}

	/** 해시로 찾는다(없으면 null). */
	public Stored find(String hash) {
		List<Stored> rows = jdbc.query(
			"SELECT password_reset_token_id,user_account_id,expires_at,consumed_at FROM password_reset_token"
				+ " WHERE token_hash=?",
			(row, number) -> new Stored(row.getLong("password_reset_token_id"), row.getLong("user_account_id"),
				KstTime.read(row, "expires_at"), KstTime.read(row, "consumed_at")),
			hash);
		return rows.isEmpty() ? null : rows.get(0);
	}

	/** 한 번만 소비한다. 아직 쓰지 않았고 만료 전이면 1, 아니면 0(동시 요청 중 하나만 1). */
	public int consume(long id, Instant at) {
		return jdbc.update(
			"UPDATE password_reset_token SET consumed_at=? WHERE password_reset_token_id=? AND consumed_at IS NULL"
				+ " AND expires_at>?",
			KstTime.of(at), id, KstTime.of(at));
	}

	/** 그 사용자의 남은 토큰을 모두 쓴 것으로 만든다(새 발급·비밀번호 변경·재설정 완료 뒤). */
	public void consumeAll(long owner, Instant at) {
		jdbc.update(
			"UPDATE password_reset_token SET consumed_at=? WHERE user_account_id=? AND consumed_at IS NULL",
			KstTime.of(at), owner);
	}

	/** 만료된 지 하루가 지난 행을 지운다. */
	public int purgeExpired(Instant before) {
		return jdbc.update("DELETE FROM password_reset_token WHERE expires_at < ?", KstTime.of(before));
	}
}
