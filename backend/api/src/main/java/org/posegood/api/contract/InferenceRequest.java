package org.posegood.api.contract;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.UUID;

/** Feature input v2 (contracts/inference-request.v2.schema.json), shared with FastAPI. */
public record InferenceRequest(
        @NotNull @Pattern(regexp = "2\\.0") String schemaVersion,
        @NotNull @Pattern(regexp = "shoulder-relative-deltas-v1") String featureVersion,
        @NotNull UUID baselineId,
        @PositiveOrZero long sequence,
        @PositiveOrZero @Max(86400000) long startMs,
        @Positive @Max(86400000) long endMs,
        @NotNull Observation.Phase phase,
        @NotNull MeasurementQuality measurementQuality,
        @Valid FeatureDeltas features) {

    public enum MeasurementQuality {
        good,
        poor
    }

    public InferenceRequest {
        if (endMs <= startMs || endMs - startMs > 1500)
            throw new IllegalArgumentException("interval must be 1..1500ms");
    }
}
