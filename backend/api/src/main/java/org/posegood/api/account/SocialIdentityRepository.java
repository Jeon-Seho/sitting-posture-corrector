package org.posegood.api.account;

import java.time.LocalDateTime;
import java.util.List;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * {@code social_identity}(제안 V2.7, DB 담당 적용 전) 읽기·쓰기: 계정과 소셜 제공자 사용자 ID의 연결.
 *
 * 제공자 쪽 이메일·이름·토큰은 저장하지 않는다. 한 제공자 사용자는 한 계정에만, 한 계정은 제공자마다 하나만 연결한다.
 */
@Repository
public class SocialIdentityRepository {
	public static final String DISCORD = "DISCORD";

	private final JdbcTemplate jdbc;

	public SocialIdentityRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** 연결 한 줄. */
	public record Link(long owner, String provider, LocalDateTime linkedAt) {
	}

	/** 제공자 사용자 ID로 연결된 계정 ID. 없으면 null. */
	public Long owner(String provider, String subject) {
		List<Long> rows = jdbc.queryForList(
			"SELECT user_account_id FROM social_identity WHERE provider=? AND provider_subject=?",
			Long.class, provider, subject);
		return rows.isEmpty() ? null : rows.get(0);
	}

	/** 그 계정의 연결 목록. */
	public List<Link> links(long owner) {
		return jdbc.query(
			"SELECT user_account_id, provider, linked_at FROM social_identity WHERE user_account_id=?"
				+ " ORDER BY provider",
			(row, number) -> new Link(row.getLong("user_account_id"), row.getString("provider"),
				row.getObject("linked_at", LocalDateTime.class)),
			owner);
	}

	/** 연결 추가. 이미 다른 계정에 연결된 제공자 사용자이거나 같은 제공자가 이미 있으면 409. */
	public void insert(long owner, String provider, String subject) {
		try {
			jdbc.update(
				"INSERT INTO social_identity(user_account_id,provider,provider_subject,linked_at) VALUES(?,?,?,?)",
				owner, provider, subject, KstTime.now());
		} catch (DuplicateKeyException exists) {
			throw new ApiError(409, "SOCIAL_ALREADY_LINKED", "this social account cannot be linked");
		}
	}

	/** 연결 해제. 지운 행 수. */
	public int delete(long owner, String provider) {
		return jdbc.update("DELETE FROM social_identity WHERE user_account_id=? AND provider=?", owner, provider);
	}
}
