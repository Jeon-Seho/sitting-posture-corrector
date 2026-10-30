package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

/**
 * 기준 자세 대비 특징 변화량(머리 간격·좌우 치우침·어깨 기울기)과 측정 품질.
 *
 * 값은 어깨 폭으로 정규화한 (현재 - 기준)이다(ADR 0020). 관절 좌표는 보내지 않는다.
 */
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
