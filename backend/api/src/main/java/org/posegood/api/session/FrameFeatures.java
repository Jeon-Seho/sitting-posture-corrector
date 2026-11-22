package org.posegood.api.session;

import java.util.List;

import org.posegood.api.contract.FeatureDeltas;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;

/**
 * 좌표 프레임 → 기준 대비 특징 변화량(A안: API가 계산하고 추론 {@code POST /infer} 입력은 그대로).
 *
 * 규칙은 BE API 명세 11.3과 FE가 넘긴 판정 규칙(2026-10-11, 합성 기준값 contracts/examples/frames/reference-rule-cases.json)이다.
 * 처음 계산식은 앱 프로토타입(develop의 model/prototype/pose.ts·serverFeatures.ts — FE V3에서 앱 판정과 함께 지움, git 이력에 남음)에서
 * 옮겼다. 값은 어깨 폭으로 정규화한다(ADR 0020).
 * 카메라는 640×480 고정이다(DB V2.3 CAPTURE_RESOLUTION). 실험용 규칙이며 의료 측정이 아니다.
 */
public final class FrameFeatures {
	static final double WIDTH = 640;
	static final double HEIGHT = 480;

	private static final int NOSE = 0;
	private static final int LEFT_EAR = 3;
	private static final int RIGHT_EAR = 4;
	private static final int LEFT_SHOULDER = 7;
	private static final int RIGHT_SHOULDER = 8;

	private FrameFeatures() {
	}

	/** 프레임 하나의 특징: 머리-어깨 간격, 좌우 치우침, 어깨 기울기, 품질. */
	public record Features(double headGap, double offset, double tilt, double quality) {
	}

	/**
	 * 관절 9개 {@code [x, y, visibility]}의 특징. 판정할 수 없으면 null.
	 *
	 * 측정 가능 여부는 FE가 전달한다. 여기서는 유한한 특징을 계산할 수 있는지만 확인한다.
	 */
	static Features features(double[][] points) {
		double[] nose = points[NOSE];
		double[] left = points[LEFT_SHOULDER];
		double[] right = points[RIGHT_SHOULDER];
		double span = Math.hypot((left[0] - right[0]) * WIDTH, (left[1] - right[1]) * HEIGHT);
		if (!Double.isFinite(span) || span <= 0) {
			return null;
		}
		double cx = (left[0] + right[0]) / 2;
		double cy = (left[1] + right[1]) / 2;
		double[] leftEar = points[LEFT_EAR];
		double[] rightEar = points[RIGHT_EAR];
		if (!Double.isFinite(leftEar[0])
			|| !Double.isFinite(leftEar[1])
			|| !Double.isFinite(rightEar[0])
			|| !Double.isFinite(rightEar[1])) {
			return null;
		}
		double head = (leftEar[0] + rightEar[0]) / 2;
		var result = new Features(
			(cy - nose[1]) * HEIGHT / span,
			(head - cx) * WIDTH / span,
			(left[1] - right[1]) * HEIGHT / span,
			Math.min(nose[2], Math.min(left[2], right[2])));
		return valid(result) ? result : null;
	}

	/** 프레임의 특징. 사람이 없거나 앱이 판정 불가로 표시했으면 null. */
	static Features features(FrameInterval.Frame frame) {
		if (!frame.tracked()) {
			return null;
		}
		var points = new double[FrameInterval.JOINTS][];
		for (int index = 0; index < points.length; index++) {
			points[index] = frame.joint(index);
		}
		return features(points);
	}

	/**
	 * 저장된 기준 좌표 18개의 특징. DB에는 visibility가 없으므로 1로 둔다.
	 *
	 * 저장된 기준의 좌표를 그대로 사용한다.
	 */
	public static Features baseline(SessionRequests.Landmarks landmarks) {
		var points = new double[FrameInterval.JOINTS][];
		List<SessionRequests.Point> list = landmarks.points();
		for (int index = 0; index < points.length; index++) {
			points[index] = new double[] {list.get(index).x(), list.get(index).y(), 1};
		}
		return features(points);
	}

	/** 마지막 프레임 하나의 특징에서 기준을 뺀다. 구형 배열에도 평균을 적용하지 않는다. */
	public static FeatureDeltas interval(FrameInterval interval, Features baseline) {
		if (interval.phase() != FrameInterval.Phase.running) {
			return null;
		}
		var frame = interval.lastFrame();
		var current = frame == null ? null : features(frame);
		return deltas(current, baseline);
	}

	/** 특징 변화량: 현재 − 기준. 유한하지 않으면 null. */
	static FeatureDeltas deltas(Features current, Features baseline) {
		if (!valid(current) || !valid(baseline)) {
			return null;
		}
		double headGap = current.headGap() - baseline.headGap();
		double offset = current.offset() - baseline.offset();
		double tilt = current.tilt() - baseline.tilt();
		if (!Double.isFinite(headGap) || !Double.isFinite(offset) || !Double.isFinite(tilt)) {
			return null;
		}
		return new FeatureDeltas(headGap, offset, tilt, current.quality(), baseline.quality());
	}

	/** 특징 값이 모두 유한한지. */
	private static boolean valid(Features value) {
		return value != null
			&& Double.isFinite(value.headGap())
			&& Double.isFinite(value.offset())
			&& Double.isFinite(value.tilt())
			&& Double.isFinite(value.quality())
			&& value.quality() >= 0
			&& value.quality() <= 1;
	}
}
