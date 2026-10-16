package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import tools.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;

import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * 좌표 → 특징 변화량 계산이 model/prototype의 pose.ts {@code features}·serverFeatures.ts {@code featureDeltas}와
 * 같은지 확인한다.
 *
 * 기대값은 같은 합성 좌표를 Node로 pose.ts에 넣어 얻은 값이다(2026-10-16, 640×480). 입력 구간과 기준은
 * contracts/realtime/examples-v2의 예시를 그대로 읽는다. 모든 좌표는 합성이다.
 */
class FrameFeaturesTest {
    private static final double EPSILON = 1e-12;
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Path EXAMPLES = Path.of("..", "..", "contracts", "realtime", "examples-v2");

    /** ws-calibration-result-ok.json의 기준 좌표(코·왼눈·…·오른어깨). */
    private static final double[][] BASELINE = {
        {0.51234, 0.40211}, {0.53011, 0.3712}, {0.49012, 0.372}, {0.56021, 0.39012}, {0.46011, 0.391},
        {0.52, 0.44}, {0.5, 0.44}, {0.66011, 0.62}, {0.36012, 0.62}
    };
    private static final double[][] SLOUCH = {
        {0.515, 0.47, 0.97}, {0.53, 0.44, 0.97}, {0.49, 0.44, 0.97}, {0.59, 0.45, 0.9}, {0.48, 0.452, 0.9},
        {0.52, 0.5, 0.97}, {0.5, 0.5, 0.97}, {0.67, 0.63, 0.92}, {0.35, 0.615, 0.88}
    };
    private static final double[][] LEAN = {
        {0.58, 0.41, 0.95}, {0.6, 0.38, 0.95}, {0.56, 0.38, 0.95}, {0.63, 0.4, 0.9}, {0.53, 0.4, 0.9},
        {0.59, 0.45, 0.95}, {0.57, 0.45, 0.95}, {0.66, 0.62, 0.8}, {0.36, 0.62, 0.85}
    };

    private static SessionRequests.Landmarks landmarks(double[][] points) {
        var p = new SessionRequests.Point[9];
        for (int i = 0; i < 9; i++) p[i] = new SessionRequests.Point(points[i][0], points[i][1]);
        return new SessionRequests.Landmarks(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
    }

    private static FrameFeatures.Features baseline() {
        var features = FrameFeatures.baseline(landmarks(BASELINE));
        assertNotNull(features);
        return features;
    }

    private static FrameInterval.Frame frame(long t, double[][] points, Boolean valid) {
        List<List<Double>> p = null;
        if (points != null) {
            p = new ArrayList<>();
            for (var joint : points) p.add(List.of(joint[0], joint[1], joint[2]));
        }
        return new FrameInterval.Frame(t, p, valid);
    }

    private static FrameInterval running(FrameInterval.Frame... frames) {
        return new FrameInterval("3.0", "keypoints-9-v1", 0, 0, 500, FrameInterval.Phase.running, List.of(frames));
    }

    private static FrameInterval example(String name) throws Exception {
        var item = MAPPER.readTree(EXAMPLES.resolve(name).toFile()).get("items").get(0);
        var frames = new ArrayList<FrameInterval.Frame>();
        for (var f : item.get("frames")) {
            double[][] points = null;
            if (!f.get("p").isNull()) {
                points = new double[9][];
                for (int i = 0; i < 9; i++) {
                    var joint = f.get("p").get(i);
                    points[i] = new double[] {joint.get(0).asDouble(), joint.get(1).asDouble(), joint.get(2).asDouble()};
                }
            }
            frames.add(frame(f.get("t_ms").asLong(), points, f.has("valid") ? f.get("valid").asBoolean() : null));
        }
        return new FrameInterval(
                item.get("schema_version").asString(),
                item.get("feature_version").asString(),
                item.get("sequence").asLong(),
                item.get("start_ms").asLong(),
                item.get("end_ms").asLong(),
                FrameInterval.Phase.valueOf(item.get("phase").asString()),
                frames);
    }

    @Test
    void forwardSlouchMatchesThePrototype() {
        var result = FrameFeatures.interval(running(frame(0, SLOUCH, null)), baseline());
        assertNull(result.invalidReason());
        var d = result.deltas();
        assertEquals(-0.1875419584789344, d.headGapDelta(), EPSILON);
        assertEquals(0.07792675994548028, d.lateralOffsetDelta(), EPSILON);
        assertEquals(0.03513454422554122, d.shoulderTiltDelta(), EPSILON);
        assertEquals(0.88, d.currentQuality(), EPSILON);
        assertEquals(1, d.baselineQuality(), EPSILON);
    }

    @Test
    void sidewaysLeanMatchesThePrototype() {
        var d = FrameFeatures.interval(running(frame(0, LEAN, null)), baseline()).deltas();
        assertEquals(-0.019743158105270053, d.headGapDelta(), EPSILON);
        assertEquals(0.23318332833316696, d.lateralOffsetDelta(), EPSILON);
        assertEquals(0, d.shoulderTiltDelta(), EPSILON);
        assertEquals(0.8, d.currentQuality(), EPSILON);
    }

    @Test
    void intervalAveragesUsableFramesAndSkipsTheRest() {
        var result =
                FrameFeatures.interval(
                        running(frame(0, SLOUCH, null), frame(60, null, null), frame(120, LEAN, null),
                                frame(180, LEAN, false)),
                        baseline());
        var d = result.deltas();
        assertEquals(-0.10364255829210223, d.headGapDelta(), EPSILON);
        assertEquals(0.1555550441393236, d.lateralOffsetDelta(), EPSILON);
        assertEquals(0.01756727211277061, d.shoulderTiltDelta(), EPSILON);
        assertEquals((0.88 + 0.8) / 2, d.currentQuality(), EPSILON);
    }

    @Test
    void contractExampleIntervalUsesOnlyTheTrackedValidFrame() throws Exception {
        // ws-features.json: 첫 프레임은 기준과 같은 좌표, 둘째는 사람 없음(p null), 셋째는 valid:false.
        var result = FrameFeatures.interval(example("ws-features.json"), baseline());
        var d = result.deltas();
        assertEquals(0, d.headGapDelta(), EPSILON);
        assertEquals(0, d.lateralOffsetDelta(), EPSILON);
        assertEquals(0, d.shoulderTiltDelta(), EPSILON);
        assertEquals(0.95, d.currentQuality(), EPSILON);
    }

    @Test
    void headTurnAndUnmeasurableReasons() {
        var turned = new double[9][];
        for (int i = 0; i < 9; i++) turned[i] = SLOUCH[i].clone();
        turned[0][0] += 0.1; // 코만 옆으로: 어깨 폭의 약 0.33 → 고개 돌림
        var result = FrameFeatures.interval(running(frame(0, turned, null)), baseline());
        assertNull(result.deltas());
        assertEquals("head_turn", result.invalidReason());

        var dim = new double[9][];
        for (int i = 0; i < 9; i++) dim[i] = SLOUCH[i].clone();
        dim[7][2] = 0.5; // 왼어깨 visibility 0.65 미만
        result = FrameFeatures.interval(running(frame(0, dim, null), frame(60, null, null)), baseline());
        assertNull(result.deltas());
        assertEquals("unmeasurable", result.invalidReason());

        var rest = new FrameInterval("3.0", "keypoints-9-v1", 1, 500, 1000, FrameInterval.Phase.rest, List.of());
        result = FrameFeatures.interval(rest, baseline());
        assertNull(result.deltas());
        assertNull(result.invalidReason());
    }

    @Test
    void framesAtTheEdgeOrTooNarrowAreUnusable() {
        var edge = new double[9][];
        for (int i = 0; i < 9; i++) edge[i] = SLOUCH[i].clone();
        edge[8][0] = 0.01;
        assertFalse(FrameFeatures.usable(frame(0, edge, null)));
        var narrow = new double[9][];
        for (int i = 0; i < 9; i++) narrow[i] = SLOUCH[i].clone();
        narrow[7][0] = 0.55;
        narrow[8][0] = 0.5;
        assertFalse(FrameFeatures.usable(frame(0, narrow, null)));
        assertTrue(FrameFeatures.usable(frame(0, SLOUCH, null)));
    }

    @Test
    void frameContractRejectsMalformedJoints() {
        assertThrows(IllegalArgumentException.class, () -> frame(0, new double[8][3], null));
        assertThrows(IllegalArgumentException.class, () -> frame(0, SLOUCH, true));
        var far = new double[9][];
        for (int i = 0; i < 9; i++) far[i] = SLOUCH[i].clone();
        far[0][0] = 2.5;
        assertThrows(IllegalArgumentException.class, () -> frame(0, far, null));
        assertThrows(
                IllegalArgumentException.class,
                () -> new FrameInterval("3.0", "keypoints-9-v1", 0, 0, 1600, FrameInterval.Phase.running, List.of()));
    }

    /** 자세 등록 판정(저장 전 단계만; 저장은 MySQL 통합 시험). */
    @Test
    void calibrationFailureReasons() throws Exception {
        var service = new SessionService(null, null, null, null, null, null, null, null, null, Duration.ofHours(1));

        var capture = new SessionService.Capture();
        capture.add(example("ws-features-calibration.json")); // 1500~2000ms, 판정 가능 1장
        assertEquals(1, capture.validFrames());
        var result = service.calibrate(1, capture, true);
        assertFalse(result.ok());
        assertEquals("incomplete", result.reason());

        capture = calibration(6, 2); // 3000ms, 12장
        assertEquals("too_few_frames", service.calibrate(1, capture, true).reason());
        assertEquals(12, service.calibrate(1, capture, true).validFrames());

        capture = calibration(6, 3); // 3000ms, 18장
        assertEquals("incomplete", service.calibrate(1, capture, false).reason());

        var out = new SessionService.Capture();
        var outside = new double[9][];
        for (int i = 0; i < 9; i++) outside[i] = SLOUCH[i].clone();
        outside[5][0] = 1.2; // 입 왼쪽이 화면 밖으로 추정됨(판정 프레임으로는 쓸 수 있다)
        for (int s = 0; s < 6; s++) {
            var frames = new ArrayList<FrameInterval.Frame>();
            for (int f = 0; f < 3; f++) frames.add(frame(s * 500L + f * 100, outside, null));
            out.add(new FrameInterval("3.0", "keypoints-9-v1", s, s * 500L, s * 500L + 500,
                    FrameInterval.Phase.calibration, frames));
        }
        assertEquals("out_of_frame", service.calibrate(1, out, true).reason());

        var measure = running(frame(0, SLOUCH, null));
        assertThrows(ApiError.class, () -> new SessionService.Capture().add(measure));
        var ordered = calibration(2, 1);
        assertThrows(ApiError.class, () -> ordered.add(new FrameInterval("3.0", "keypoints-9-v1", 1, 500, 1000,
                FrameInterval.Phase.calibration, List.of())));
    }

    private static SessionService.Capture calibration(int intervals, int framesPerInterval) {
        var capture = new SessionService.Capture();
        for (int s = 0; s < intervals; s++) {
            var frames = new ArrayList<FrameInterval.Frame>();
            for (int f = 0; f < framesPerInterval; f++) frames.add(frame(s * 500L + f * 100, SLOUCH, null));
            frames.add(frame(s * 500L + 450, null, null));
            capture.add(new FrameInterval("3.0", "keypoints-9-v1", s, s * 500L, s * 500L + 500,
                    FrameInterval.Phase.calibration, frames));
        }
        return capture;
    }
}
