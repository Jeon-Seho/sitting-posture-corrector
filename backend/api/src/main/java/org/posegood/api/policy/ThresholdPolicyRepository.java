package org.posegood.api.policy;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.Policy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * 판정 정책(threshold_policy) 찾기·추가. 정책 행은 한 번 쓰면 고치지 않는다.
 *
 * 설정을 바꾸면 같은 값 5개의 USER 행을 찾거나 추가한다(BR-64, BR-65).
 * 기본 정책은 값이 아니라 설정된 이름으로 찾는다.
 */
@Repository
public class ThresholdPolicyRepository {
    private final JdbcTemplate jdbc;
    private final String defaultName;

    public ThresholdPolicyRepository(
            JdbcTemplate jdbc, @Value("${posegood.default-policy-name}") String defaultName) {
        this.jdbc = jdbc;
        this.defaultName = defaultName;
    }

    /** 가입 때 연결하는 기본 정책(DEFAULT_TEMP)의 ID. */
    public long defaultId() {
        var rows =
                jdbc.queryForList(
                        "SELECT threshold_policy_id FROM threshold_policy WHERE policy_name=?",
                        Long.class,
                        defaultName);
        if (rows.isEmpty()) throw new IllegalStateException("default threshold policy seed is missing");
        return rows.getFirst();
    }

    /** 정책 행 읽기. */
    public Values read(long id) {
        return jdbc.queryForObject(
                "SELECT threshold,hold_seconds,recover_seconds,realert_seconds,notify_max_per_hour"
                        + " FROM threshold_policy WHERE threshold_policy_id=?",
                (row, n) ->
                        new Values(
                                row.getBigDecimal(1),
                                row.getBigDecimal(2),
                                row.getBigDecimal(3),
                                row.getInt(4),
                                row.getInt(5)),
                id);
    }

    /**
     * 같은 값의 정책 행을 찾고, 없으면 USER 행으로 추가한다.
     *
     * 시간당 알림 상한은 사용자가 바꿀 수 없어 기본 정책 값을 따른다.
     */
    public long resolve(Values requested) {
        var values = requested.withCap(read(defaultId()).notifyMaxPerHour());
        var found = find(values);
        if (found != null) return found;
        try {
            jdbc.update(
                    "INSERT INTO threshold_policy(threshold,hold_seconds,recover_seconds,"
                            + "realert_seconds,notify_max_per_hour,policy_name,created_by,created_at)"
                            + " VALUES(?,?,?,?,?,NULL,'USER',?)",
                    values.threshold(),
                    values.holdSeconds(),
                    values.recoverSeconds(),
                    values.realertSeconds(),
                    values.notifyMaxPerHour(),
                    KstTime.now());
        } catch (DuplicateKeyException concurrent) {
            // 다른 요청이 같은 조합을 먼저 추가했다(UK-03).
        }
        return find(values);
    }

    private Long find(Values values) {
        List<Long> rows =
                jdbc.queryForList(
                        "SELECT threshold_policy_id FROM threshold_policy WHERE threshold=? AND"
                                + " hold_seconds=? AND recover_seconds=? AND realert_seconds=? AND"
                                + " notify_max_per_hour=?",
                        Long.class,
                        values.threshold(),
                        values.holdSeconds(),
                        values.recoverSeconds(),
                        values.realertSeconds(),
                        values.notifyMaxPerHour());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /**
     * 정책 값 5개: 임계값, 붕괴 확정, 회복, 재알림, 시간당 알림 상한.
     *
     * DB에 그대로 담을 수 없는 값은 반올림하지 않고 거부한다.
     */
    public record Values(
            BigDecimal threshold,
            BigDecimal holdSeconds,
            BigDecimal recoverSeconds,
            int realertSeconds,
            int notifyMaxPerHour) {

        public static Values of(Policy policy) {
            if (policy.holdMs() % 500 != 0
                    || policy.recoveryMs() % 500 != 0
                    || policy.reminderMs() % 1000 != 0
                    || policy.holdMs() > 999_500
                    || policy.recoveryMs() > 999_500)
                throw ApiError.badRequest("policy is not representable in threshold_policy");
            var threshold = BigDecimal.valueOf(policy.threshold());
            if (threshold.stripTrailingZeros().scale() > 3)
                throw ApiError.badRequest("policy is not representable in threshold_policy");
            return new Values(
                    threshold.setScale(3, RoundingMode.UNNECESSARY),
                    BigDecimal.valueOf(policy.holdMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
                    BigDecimal.valueOf(policy.recoveryMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
                    Math.toIntExact(policy.reminderMs() / 1000),
                    0);
        }

        /** 설정 화면 값(초 단위)으로 만든다. 같은 검사 규칙을 쓴다. */
        public static Values ofSeconds(double hold, double recover, double realert, double threshold) {
            if (hold * 2 != Math.rint(hold * 2)
                    || recover * 2 != Math.rint(recover * 2)
                    || realert != Math.rint(realert)
                    || realert < 1)
                throw ApiError.badRequest("invalid storage contract");
            return of(
                    new Policy(
                            Math.round(hold * 1000),
                            Math.round(recover * 1000),
                            Math.round(realert * 1000),
                            threshold));
        }

        Values withCap(int cap) {
            return new Values(threshold, holdSeconds, recoverSeconds, realertSeconds, cap);
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
