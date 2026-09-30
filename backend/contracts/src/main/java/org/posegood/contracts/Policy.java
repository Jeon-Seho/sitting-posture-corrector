package org.posegood.contracts;

import jakarta.validation.constraints.*;

/** Frozen per session; recovery 2s preserves the existing prototype, pending product decision. */
public record Policy(@Positive @Max(86400000) long holdMs,
                     @Positive @Max(86400000) long recoveryMs,
                     @Positive @Max(86400000) long reminderMs,
                     @DecimalMin(value="0", inclusive=false) @DecimalMax("1") double threshold) {
    public static Policy defaults() { return new Policy(3000, 2000, 60000, .7); }
    public Policy {
        if (!Double.isFinite(threshold)) throw new IllegalArgumentException("threshold must be finite");
    }
}
