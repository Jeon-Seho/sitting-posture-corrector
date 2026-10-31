package org.posegood.api.policy;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.Policy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 판정 정책(threshold_policy) 찾기·추가. 정책 행은 한 번 쓰면 고치지 않는다.
 *
 * V2.3의 값 네 개로 행을 찾고 없으면 추가한다. 과거 정책 행은 변경하지 않는다.
 */
@Repository
public class ThresholdPolicyRepository {
	private final JdbcTemplate jdbc;
	private final Values defaults;

	public ThresholdPolicyRepository(
		JdbcTemplate jdbc,
		@Value("${posegood.default-policy.threshold:0.7}")
		double threshold,
		@Value("${posegood.default-policy.hold-seconds:3}")
		double hold,
		@Value("${posegood.default-policy.recover-seconds:3}")
		double recover,
		@Value("${posegood.default-policy.realert-seconds:60}")
		double realert) {
		this.jdbc = jdbc;
		this.defaults = Values.ofSeconds(hold, recover, realert, threshold);
	}

	/** 가입 때 연결하는 기본값 조합. 시드가 없으면 같은 값으로 생성한다. */
	public long defaultId() {
		return resolve(defaults);
	}

	/** 정책 행 읽기. */
	public Values read(long id) {
		return jdbc.queryForObject(
			"SELECT threshold,hold_seconds,recover_seconds,realert_seconds"
				+ " FROM threshold_policy WHERE threshold_policy_id=?",
			(row, n) -> new Values(
				row.getBigDecimal(1),
				row.getBigDecimal(2),
				row.getBigDecimal(3),
				row.getInt(4)),
			id);
	}

	/**
	 * 같은 값의 정책 행을 찾고, 없으면 추가한다.
	 */
	public long resolve(Values requested) {
		var values = requested;
		var found = find(values);
		if (found != null) {
			return found;
		}
		try {
			jdbc.update(
				"INSERT INTO threshold_policy(threshold,hold_seconds,recover_seconds,"
					+ "realert_seconds,created_at) VALUES(?,?,?,?,?)",
				values.threshold(),
				values.holdSeconds(),
				values.recoverSeconds(),
				values.realertSeconds(),
				KstTime.now());
		} catch (DuplicateKeyException concurrent) {
			// 다른 요청이 같은 조합을 먼저 추가했다(UK-03).
		}
		return find(values);
	}

	private Long find(Values values) {
		List<Long> rows = jdbc.queryForList(
			"SELECT threshold_policy_id FROM threshold_policy WHERE threshold=? AND"
				+ " hold_seconds=? AND recover_seconds=? AND realert_seconds=?",
			Long.class,
			values.threshold(),
			values.holdSeconds(),
			values.recoverSeconds(),
			values.realertSeconds());
		return rows.isEmpty() ? null : rows.get(0);
	}

	/**
	 * 정책 값 네 개: 임계값, 붕괴 확정, 회복, 재알림.
	 *
	 * DB에 그대로 담을 수 없는 값은 반올림하지 않고 거부한다.
	 */
	public record Values(
		BigDecimal threshold,
		BigDecimal holdSeconds,
		BigDecimal recoverSeconds,
		int realertSeconds) {

		public static Values of(Policy policy) {
			if (policy.holdMs() % 500 != 0
				|| policy.recoveryMs() % 500 != 0
				|| policy.reminderMs() % 1000 != 0
				|| policy.holdMs() > 999_500
				|| policy.recoveryMs() > 999_500) {
				throw ApiError.badRequest("policy is not representable in threshold_policy");
			}
			var threshold = BigDecimal.valueOf(policy.threshold());
			if (threshold.stripTrailingZeros().scale() > 3) {
				throw ApiError.badRequest("policy is not representable in threshold_policy");
			}
			return new Values(
				threshold.setScale(3, RoundingMode.UNNECESSARY),
				BigDecimal.valueOf(policy.holdMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
				BigDecimal.valueOf(policy.recoveryMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
				Math.toIntExact(policy.reminderMs() / 1000));
		}

		/** 설정 화면 값(초 단위)으로 만든다. 같은 검사 규칙을 쓴다. */
		public static Values ofSeconds(double hold, double recover, double realert, double threshold) {
			if (hold * 2 != Math.rint(hold * 2)
				|| recover * 2 != Math.rint(recover * 2)
				|| realert != Math.rint(realert)
				|| realert < 1) {
				throw ApiError.badRequest("invalid storage contract");
			}
			return of(
				new Policy(
					Math.round(hold * 1000),
					Math.round(recover * 1000),
					Math.round(realert * 1000),
					threshold));
		}

		public Policy policy() {
			return new Policy(
				holdSeconds.movePointRight(3).longValueExact(),
				recoverSeconds.movePointRight(3).longValueExact(),
				realertSeconds * 1000L,
				threshold.doubleValue());
		}
	}
}
