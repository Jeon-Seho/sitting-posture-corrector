package org.posegood.api.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

import org.posegood.api.common.KstTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * `refresh_token`(DB V2.6, T-51) 읽기·쓰기. 토큰 원문은 저장하지 않고 SHA-256(16진수)만 둔다.
 *
 * 시각은 다른 테이블처럼 KST {@code DATETIME(3)}로 주고받는다({@link KstTime}).
 */
@Repository
public class RefreshTokenRepository {
	private final JdbcTemplate jdbc;

	public RefreshTokenRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 한 토큰 행. 아직 쓰지 않았으면 {@code rotatedAt}, 철회되지 않았으면 {@code revokedAt}이 null이다. */
	public record Stored(long id, long owner, Instant issuedAt, Instant expiresAt, Instant rotatedAt,
		Instant revokedAt) {
	}

	public void insert(long owner, String hash, Instant issuedAt, Instant expiresAt) {
		jdbc.update(
			"INSERT INTO refresh_token (user_account_id,token_hash,issued_at,expires_at) VALUES (?,?,?,?)",
			owner,
			hash,
			KstTime.of(issuedAt),
			KstTime.of(expiresAt));
	}

	/** 해시로 찾는다(없으면 null). */
	public Stored find(String hash) {
		List<Stored> rows = jdbc.query("SELECT * FROM refresh_token WHERE token_hash=?", this::stored, hash);
		return rows.isEmpty() ? null : rows.get(0);
	}

	/** 처음 쓸 때만 교체 시각을 적는다. 이미 적혀 있으면 그대로 둔다(동시에 온 재사용은 유예 판단에 맡김). */
	public void markRotated(long id, Instant at) {
		jdbc.update(
			"UPDATE refresh_token SET rotated_at=? WHERE refresh_token_id=? AND rotated_at IS NULL",
			KstTime.of(at),
			id);
	}

	public void revoke(long id, Instant at) {
		jdbc.update(
			"UPDATE refresh_token SET revoked_at=? WHERE refresh_token_id=? AND revoked_at IS NULL",
			KstTime.of(at),
			id);
	}

	/** 그 사용자의 토큰을 모두 철회한다 = 모든 기기 로그아웃(비밀번호 변경·탈퇴·재사용 감지). */
	public void revokeAll(long owner, Instant at) {
		jdbc.update(
			"UPDATE refresh_token SET revoked_at=? WHERE user_account_id=? AND revoked_at IS NULL",
			KstTime.of(at),
			owner);
	}

	/** 만료된 지 하루가 지난 행을 지운다. */
	public int purgeExpired(Instant before) {
		return jdbc.update("DELETE FROM refresh_token WHERE expires_at < ?", KstTime.of(before));
	}

	private Stored stored(ResultSet row, int rowNumber) throws SQLException {
		return new Stored(
			row.getLong("refresh_token_id"),
			row.getLong("user_account_id"),
			KstTime.read(row, "issued_at"),
			KstTime.read(row, "expires_at"),
			KstTime.read(row, "rotated_at"),
			KstTime.read(row, "revoked_at"));
	}
}
