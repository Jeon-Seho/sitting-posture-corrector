package org.posegood.api.contract;

import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * 앱이 보내는 특징 입력 한 구간(v2). FastAPI 추론에 그대로 넘긴다.
 *
 * 계약: contracts/inference-request.v2.schema.json(FastAPI와 공유).
 */
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
		if (endMs <= startMs || endMs - startMs > 1500) {
			throw new IllegalArgumentException("interval must be 1..1500ms");
		}
	}
}
