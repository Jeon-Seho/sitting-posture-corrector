package org.posegood.contracts;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/** Synthetic or authorized model output; end-exclusive interval in session elapsed time. */
public record Observation(
        @NotNull @Pattern(regexp = "2\\.0") String schemaVersion,
        @PositiveOrZero long sequence,
        @PositiveOrZero @Max(86400000) long startMs,
        @Positive @Max(86400000) long endMs,
        @NotNull Phase phase,
        boolean valid,
        @DecimalMin("0") @DecimalMax("1") double collapseProbability,
        @NotNull DeviationType deviationType,
        @NotNull @Pattern(regexp = "[a-z0-9._-]{1,64}") String modelVersion) {

    public enum Phase {
        running,
        rest,
        away
    }

    public enum DeviationType {
        none,
        forward_slouch,
        left_lean,
        right_lean,
        unspecified
    }

    public Observation {
        if (endMs <= startMs || endMs - startMs > 1500 || !Double.isFinite(collapseProbability)) {
            throw new IllegalArgumentException("interval must be 1..1500ms and probability finite");
        }
    }
}
