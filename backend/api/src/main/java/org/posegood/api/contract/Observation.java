package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * 추론 결과 한 구간(관측 v2): 측정 가능 여부, 붕괴 확률, 자세 방향.
 *
 * 구간은 [startMs, endMs)이다(끝은 포함하지 않음).
 */
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
        if (endMs <= startMs || endMs - startMs > 1500 || !Double.isFinite(collapseProbability))
            throw new IllegalArgumentException("interval must be 1..1500ms and score finite");
    }
}
