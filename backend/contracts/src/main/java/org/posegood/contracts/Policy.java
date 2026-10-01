package org.posegood.contracts;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;

/**
 * Frozen per session; setting changes apply to the next session. Accepted default timing is
 * collapse 3s, recovery 2s, and same-episode reminder 60s. See ADR 0012 in {@code
 * docs/decisions/0012-session-timing-policy.md}.
 */
public record Policy(
        @Positive @Max(86400000) long holdMs,
        @Positive @Max(86400000) long recoveryMs,
        @Positive @Max(86400000) long reminderMs,
        @DecimalMin(value = "0", inclusive = false) @DecimalMax("1") double threshold) {

    public static Policy defaults() {
        return new Policy(3000, 2000, 60000, 0.7);
    }

    public Policy {
        if (!Double.isFinite(threshold)) {
            throw new IllegalArgumentException("threshold must be finite");
        }
    }
}
