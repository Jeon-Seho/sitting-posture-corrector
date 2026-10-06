package org.posegood.api.persistence;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.Policy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * `threshold_policy` rows are immutable (BR-64, BR-65). A changed setting finds or adds a USER row
 * with the same five values; the system default is looked up by name, never by literal values.
 */
@Repository
@Profile("persistent")
public class ThresholdPolicyStore {
    private final JdbcTemplate jdbc;
    private final String defaultName;

    public ThresholdPolicyStore(
            JdbcTemplate jdbc,
            @Value("${posegood.default-policy-name:DEFAULT_TEMP}") String defaultName) {
        this.jdbc = jdbc;
        this.defaultName = defaultName;
    }

    public long defaultId() {
        var rows =
                jdbc.queryForList(
                        "SELECT threshold_policy_id FROM threshold_policy WHERE policy_name=?",
                        Long.class,
                        defaultName);
        if (rows.isEmpty())
            throw new IllegalStateException("default threshold policy seed is missing");
        return rows.getFirst();
    }

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

    /** Finds or adds the immutable row; the hourly cap is not user-editable and follows default. */
    public long resolve(Values requested) {
        int cap = read(defaultId()).notifyMaxPerHour();
        var values =
                new Values(
                        requested.threshold(),
                        requested.holdSeconds(),
                        requested.recoverSeconds(),
                        requested.realertSeconds(),
                        cap);
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
                    DbTime.now());
        } catch (DuplicateKeyException concurrent) {
            /* Another account added the same combination first. */
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

    /** Converts a session policy; values the schema cannot store exactly are rejected, not rounded. */
    public static Values of(Policy policy) {
        if (policy.holdMs() % 500 != 0
                || policy.recoveryMs() % 500 != 0
                || policy.reminderMs() % 1000 != 0
                || policy.holdMs() > 999_500
                || policy.recoveryMs() > 999_500)
            throw new ContractError(400, "policy is not representable in threshold_policy");
        return new Values(
                threshold(policy.threshold()),
                BigDecimal.valueOf(policy.holdMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
                BigDecimal.valueOf(policy.recoveryMs(), 3).setScale(1, RoundingMode.UNNECESSARY),
                Math.toIntExact(policy.reminderMs() / 1000),
                0);
    }

    /** Settings use seconds; the same representability rule applies. */
    public static Values ofSeconds(double hold, double recover, double realert, double threshold) {
        if (hold * 2 != Math.rint(hold * 2)
                || recover * 2 != Math.rint(recover * 2)
                || realert != Math.rint(realert)
                || realert < 1) WorkspaceValidator.invalid();
        return of(
                new Policy(
                        Math.round(hold * 1000),
                        Math.round(recover * 1000),
                        Math.round(realert * 1000),
                        threshold));
    }

    private static BigDecimal threshold(double value) {
        var decimal = BigDecimal.valueOf(value);
        if (decimal.stripTrailingZeros().scale() > 3)
            throw new ContractError(400, "policy is not representable in threshold_policy");
        return decimal.setScale(3, RoundingMode.UNNECESSARY);
    }

    public record Values(
            BigDecimal threshold,
            BigDecimal holdSeconds,
            BigDecimal recoverSeconds,
            int realertSeconds,
            int notifyMaxPerHour) {
        public Policy policy() {
            return new Policy(
                    holdSeconds.movePointRight(3).longValueExact(),
                    recoverSeconds.movePointRight(3).longValueExact(),
                    realertSeconds * 1000L,
                    threshold.doubleValue());
        }
    }
}
