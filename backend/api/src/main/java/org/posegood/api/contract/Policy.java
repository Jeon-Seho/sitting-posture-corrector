package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;

/**
 * Session timing policy, frozen when the session is created (ADR 0012). Settings changed later apply
 * to the next session only.
 */
public record Policy(
        @Positive @Max(86400000) long holdMs,
        @Positive @Max(86400000) long recoveryMs,
        @Positive @Max(86400000) long reminderMs,
        @DecimalMin(value = "0", inclusive = false) @DecimalMax("1") double threshold) {

    public Policy {
        if (!Double.isFinite(threshold)) throw new IllegalArgumentException("threshold must be finite");
    }
}
