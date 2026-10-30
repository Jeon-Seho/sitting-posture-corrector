package org.posegood.api.session;

import org.posegood.api.contract.FeatureDeltas;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;

import java.util.ArrayList;
import java.util.List;

/**
 * 좌표 프레임 → 기준 대비 특징 변화량(A안: API가 계산하고 추론 {@code POST /v2/infer} 입력은 그대로).
 *
 * 규칙은 BE API 명세 11.3과 FE가 넘긴 판정 규칙(2026-10-11, 합성 기준값 contracts/examples/frames/reference-rule-cases.json)이다.
 * 처음 계산식은 앱 프로토타입(develop의 model/prototype/pose.ts·serverFeatures.ts — FE V3에서 앱 판정과 함께 지움, git 이력에 남음)에서
 * 옮겼다. 값은 어깨 폭으로 정규화한다(ADR 0020). 0.65·0.02·0.1·0.15는 프로토타입의 검증 전 값이다.
 * 카메라는 640×480 고정이다(DB V2.3 CAPTURE_RESOLUTION). 실험용 규칙이며 의료 측정이 아니다.
 */
public final class FrameFeatures {
    static final double WIDTH = 640;
    static final double HEIGHT = 480;
    static final double MIN_QUALITY = 0.65;
    static final double EDGE = 0.02;
    static final double MIN_SPAN = 0.1;
    /** 코-귀 중점 변화가 이보다 크면 고개를 돌린 것으로 보고 판정하지 않는다(고개 돌림, BE 명세 11.3 {@code head_turn}). */
    static final double HEAD_TURN_LIMIT = 0.15;

    private static final int NOSE = 0;
    private static final int LEFT_EAR = 3;
    private static final int RIGHT_EAR = 4;
    private static final int LEFT_SHOULDER = 7;
    private static final int RIGHT_SHOULDER = 8;

    private FrameFeatures() {}

    /** 프레임 하나의 특징: 머리-어깨 간격, 좌우 치우침, 어깨 기울기, 품질, 고개 돌림(코-귀 중점). */
    public record Features(double headGap, double offset, double tilt, double quality, double turn) {}

    /**
     * 구간 하나의 계산 결과.
     *
     * {@code deltas}가 null이면 판정에 쓸 프레임이 없다. 그때 {@code invalidReason}은 고개 돌림만 있었으면
     * {@code head_turn}, 아니면 {@code unmeasurable}이다. running이 아닌 구간은 둘 다 null이다.
     */
    public record Result(FeatureDeltas deltas, String invalidReason) {}

    /**
     * 관절 9개 {@code [x, y, visibility]}의 특징. 판정할 수 없으면 null.
     *
     * 코·양 어깨: visibility 0.65~1, 좌표 0.02~0.98. 어깨 폭은 화면 너비의 10% 이상. 양 귀는 좌표만 있으면 된다.
     */
    static Features features(double[][] points) {
        double[] nose = points[NOSE], left = points[LEFT_SHOULDER], right = points[RIGHT_SHOULDER];
        for (double[] p : new double[][] {nose, left, right})
            if (!Double.isFinite(p[0])
                    || !Double.isFinite(p[1])
                    || !Double.isFinite(p[2])
                    || p[2] < MIN_QUALITY
                    || p[2] > 1
                    || p[0] < EDGE
                    || p[0] > 1 - EDGE
                    || p[1] < EDGE
                    || p[1] > 1 - EDGE) return null;
        double span = Math.hypot((left[0] - right[0]) * WIDTH, (left[1] - right[1]) * HEIGHT);
        if (span < WIDTH * MIN_SPAN) return null;
        double cx = (left[0] + right[0]) / 2, cy = (left[1] + right[1]) / 2;
        double[] leftEar = points[LEFT_EAR], rightEar = points[RIGHT_EAR];
        if (!Double.isFinite(leftEar[0])
                || !Double.isFinite(leftEar[1])
                || !Double.isFinite(rightEar[0])
                || !Double.isFinite(rightEar[1])) return null;
        double head = (leftEar[0] + rightEar[0]) / 2;
        var result =
                new Features(
                        (cy - nose[1]) * HEIGHT / span,
                        (head - cx) * WIDTH / span,
                        (left[1] - right[1]) * HEIGHT / span,
                        Math.min(nose[2], Math.min(left[2], right[2])),
                        (nose[0] - head) * WIDTH / span);
        return valid(result) ? result : null;
    }

    /** 프레임의 특징. 사람이 없거나 앱이 판정 불가로 표시했으면 null. */
    static Features features(FrameInterval.Frame frame) {
        if (!frame.tracked()) return null;
        var points = new double[FrameInterval.JOINTS][];
        for (int index = 0; index < points.length; index++) points[index] = frame.joint(index);
        return features(points);
    }

    /**
     * 저장된 기준 좌표 18개의 특징. DB에는 visibility가 없으므로 1로 둔다.
     *
     * 기준은 판정 가능 프레임(visibility 0.65 이상)만 평균한 값이라 품질 1은 추론의 0.65 검사를 바꾸지 않는다.
     */
    public static Features baseline(SessionRequests.Landmarks landmarks) {
        var points = new double[FrameInterval.JOINTS][];
        List<SessionRequests.Point> list = landmarks.points();
        for (int index = 0; index < points.length; index++)
            points[index] = new double[] {list.get(index).x(), list.get(index).y(), 1};
        return features(points);
    }

    /**
     * 구간의 특징 변화량. 고개를 돌리지 않은 판정 가능 프레임의 특징을 평균해 기준을 뺀다.
     *
     * 고개를 돌린 프레임은 판정에서 뺀다(BE 명세 11.3). 원시 변화량은 자르지 않는다.
     */
    public static Result interval(FrameInterval interval, Features baseline) {
        if (interval.phase() != FrameInterval.Phase.running) return new Result(null, null);
        var usable = new ArrayList<Features>();
        boolean turned = false;
        for (var frame : interval.frames()) {
            var current = features(frame);
            if (current == null) continue;
            if (headTurned(current, baseline)) turned = true;
            else usable.add(current);
        }
        if (usable.isEmpty()) return new Result(null, turned ? "head_turn" : "unmeasurable");
        var deltas = deltas(average(usable), baseline);
        return deltas == null ? new Result(null, "unmeasurable") : new Result(deltas, null);
    }

    /** 특징 변화량: 현재 − 기준. 유한하지 않으면 null. */
    static FeatureDeltas deltas(Features current, Features baseline) {
        if (!valid(current) || !valid(baseline)) return null;
        double headGap = current.headGap() - baseline.headGap();
        double offset = current.offset() - baseline.offset();
        double tilt = current.tilt() - baseline.tilt();
        if (!Double.isFinite(headGap) || !Double.isFinite(offset) || !Double.isFinite(tilt)) return null;
        return new FeatureDeltas(headGap, offset, tilt, current.quality(), baseline.quality());
    }

    static boolean headTurned(Features current, Features baseline) {
        return Math.abs(current.turn() - baseline.turn()) > HEAD_TURN_LIMIT;
    }

    /** 프레임 특징의 단순 평균. */
    static Features average(List<Features> samples) {
        double headGap = 0, offset = 0, tilt = 0, quality = 0, turn = 0;
        for (var s : samples) {
            headGap += s.headGap();
            offset += s.offset();
            tilt += s.tilt();
            quality += s.quality();
            turn += s.turn();
        }
        int n = samples.size();
        return new Features(headGap / n, offset / n, tilt / n, quality / n, turn / n);
    }

    /** 특징 값이 모두 유한한지. */
    private static boolean valid(Features value) {
        return value != null
                && Double.isFinite(value.headGap())
                && Double.isFinite(value.offset())
                && Double.isFinite(value.tilt())
                && Double.isFinite(value.quality())
                && Double.isFinite(value.turn())
                && value.quality() >= MIN_QUALITY
                && value.quality() <= 1;
    }
}
