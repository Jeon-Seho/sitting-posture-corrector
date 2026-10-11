package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

/** Shoulder-normalized current-minus-baseline changes and qualities (ADR 0013); never landmarks. */
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
                || !Double.isFinite(baselineQuality))
            throw new IllegalArgumentException("feature values must be finite");
    }
}
