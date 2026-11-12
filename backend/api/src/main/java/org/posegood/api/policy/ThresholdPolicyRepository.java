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
 * 값 네 개로 행을 찾고 없으면 추가한다. 과거 정책 행은 변경하지 않는다.
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
		try {
			this.defaults = Values.ofSeconds(hold, recover, realert, threshold);
		} catch (ApiError | IllegalArgumentException invalid) {
			// 잘못된 기본값으로 시작하면 첫 가입 때에야 DB 오류가 나거나 판정이 망가진다. 시작부터 막는다.
			throw new IllegalStateException(
				"posegood.default-policy.* is invalid: threshold 0<x<=1, hold·recover 0.5s steps above 0,"
					+ " realert whole seconds 1..86400",
				invalid);
		}
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
	 *
	 * 다른 요청이 같은 조합을 동시에 추가해 중복 오류(UK-03)가 나면 그 행을 잠금 읽기({@code FOR SHARE})로 다시 찾는다.
	 * 트랜잭션 안의 일반 SELECT는 처음 읽은 시점의 스냅샷(MySQL 기본 REPEATABLE READ)을 보므로, 방금 커밋된 그 행이
	 * 보이지 않는다.
	 */
	public long resolve(Values values) {
		var found = find(values, false);
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
			found = find(values, false);
		} catch (DuplicateKeyException concurrent) {
			found = find(values, true);
		}
		if (found == null) {
			throw new IllegalStateException("threshold_policy row not found after insert");
		}
		return found;
	}

	/** {@code latest}: 스냅샷 대신 최신 커밋을 읽는다(잠금 읽기). */
	private Long find(Values values, boolean latest) {
		List<Long> rows = jdbc.queryForList(
			"SELECT threshold_policy_id FROM threshold_policy WHERE threshold=? AND"
				+ " hold_seconds=? AND recover_seconds=? AND realert_seconds=?"
				+ (latest ? " FOR SHARE" : ""),
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
	 * DB에 그대로 담을 수 없는 값은 반올림하지 않고 거부한다. 범위(확정·회복·재알림 0 초과, 재알림 24시간 이하,
	 * 임계값 0 초과 1 이하)를 벗어난 값도 거부한다 — DB CHECK는 임계값 0을 받아 주지만 그러면 모든 구간이 이탈 후보다.
	 */
	public record Values(
		BigDecimal threshold,
		BigDecimal holdSeconds,
		BigDecimal recoverSeconds,
		int realertSeconds) {

		/** 재알림 상한: 계약의 시각 상한(24시간)과 같다. */
		static final long MAX_REMINDER_MS = 86_400_000;

		public static Values of(Policy policy) {
			if (policy.holdMs() <= 0
				|| policy.recoveryMs() <= 0
				|| policy.reminderMs() <= 0
				|| policy.reminderMs() > MAX_REMINDER_MS
				|| !(policy.threshold() > 0 && policy.threshold() <= 1)) {
				throw ApiError.badRequest("policy is out of range");
			}
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
