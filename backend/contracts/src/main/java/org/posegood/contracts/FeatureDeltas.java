package org.posegood.contracts;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

/** Dimensionless changes from a local shoulder-relative baseline; never raw landmarks. */
public record FeatureDeltas(
        double headGapDelta,
        double lateralOffsetDelta,
        double shoulderTiltDelta,
        @DecimalMin("0") @DecimalMax("1") double currentQuality,
        @DecimalMin("0") @DecimalMax("1") double baselineQuality) {

    public FeatureDeltas {
        if (!Double.isFinite(headGapDelta)
                || !Double.isFinite(lateralOffsetDelta)
                || !Double.isFinite(shoulderTiltDelta)
                || !Double.isFinite(currentQuality)
                || !Double.isFinite(baselineQuality)) {
            throw new IllegalArgumentException("feature values must be finite");
        }
    }
}
