package org.posegood.api.contract;

import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * 특징 입력 한 구간(v2): 서버가 앱의 좌표 구간({@link FrameInterval})에서 계산해 FastAPI 추론에 보낸다.
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
