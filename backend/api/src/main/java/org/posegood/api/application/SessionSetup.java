package org.posegood.api.application;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Persistent-mode session prerequisites for schema V1.1 (`capture_device`, `baseline_posture`,
 * `baseline_feature`, frame size). The development memory mode ignores it. Values are
 * calibration aggregates only: no image, landmark, or per-frame sample crosses this boundary.
 */
public record SessionSetup(
        @NotNull @Valid Device device, @NotNull @Valid Frame frame, @NotNull @Valid Baseline baseline) {
    public record Device(
            @NotBlank @Size(max = 128) @Pattern(regexp = "[\\x21-\\x7e]+") String key,
            @NotBlank @Size(max = 100) String label) {}

    public record Frame(@Min(1) @Max(16384) int width, @Min(1) @Max(16384) int height) {}

    /** Calibration summary; DB precision is 0.1s, 3 decimals for ratios, 6 for feature values. */
    public record Baseline(
            @NotNull UUID baselineId,
            @Min(100) @Max(999900) long calibrationMs,
            @Min(1) @Max(100000) int sampleCount,
            @DecimalMin("0") @DecimalMax("1") double targetCenterX,
            @DecimalMin("0") @DecimalMax("1") double targetCenterY,
            @DecimalMin("0") @DecimalMax("1") double targetAreaRatio,
            @NotNull @Valid FeatureStat headGap,
            @NotNull @Valid FeatureStat lateralOffset,
            @NotNull @Valid FeatureStat shoulderTilt) {
        public Baseline {
            if (!Double.isFinite(targetCenterX)
                    || !Double.isFinite(targetCenterY)
                    || !Double.isFinite(targetAreaRatio))
                throw new IllegalArgumentException("baseline target must be finite");
        }
    }

    public record FeatureStat(
            @DecimalMin("-999.999999") @DecimalMax("999.999999") double mean,
            @DecimalMin("0") @DecimalMax("999.999999") double std) {
        public FeatureStat {
            if (!Double.isFinite(mean) || !Double.isFinite(std))
                throw new IllegalArgumentException("baseline feature must be finite");
        }
    }
}
