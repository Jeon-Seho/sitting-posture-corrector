package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInterval;

import java.util.ArrayList;
import java.util.List;

/** 자세 등록 프레임 평균과 거절 사유(저장은 MySQL 통합 시험). 모든 좌표는 합성이다. */
class BaselineFramesTest {
    private static final double EPSILON = 1e-9;
    private static final double[][] UPRIGHT = {
        {0.515, 0.47, 0.97}, {0.53, 0.44, 0.97}, {0.49, 0.44, 0.97}, {0.59, 0.45, 0.9}, {0.48, 0.452, 0.9},
        {0.52, 0.5, 0.97}, {0.5, 0.5, 0.97}, {0.67, 0.63, 0.92}, {0.35, 0.615, 0.88}
    };

    private static FrameInterval.Frame frame(long t, double[][] points) {
        List<List<Double>> p = null;
        if (points != null) {
            p = new ArrayList<>();
            for (var joint : points) p.add(List.of(joint[0], joint[1], joint[2]));
        }
        return new FrameInterval.Frame(t, p, null);
    }

    /** {@code count}장을 0~{@code spanMs}에 고르게 놓는다. */
    private static List<FrameInterval.Frame> capture(int count, long spanMs, double[][] points) {
        var frames = new ArrayList<FrameInterval.Frame>();
        for (int i = 0; i < count; i++) frames.add(frame(spanMs * i / (count - 1), points));
        return frames;
    }

    private static String reason(List<FrameInterval.Frame> frames) {
        var error = assertThrows(ApiError.class, () -> BaselineFrames.mean(frames));
        assertEquals(422, error.status());
        assertEquals("BASELINE_REJECTED", error.code());
        return error.reason();
    }

    @Test
    void averagesUsableFramesOnly() {
        var shifted = new double[9][];
        for (int i = 0; i < 9; i++) shifted[i] = UPRIGHT[i].clone();
        shifted[0][0] = 0.535;
        var frames = new ArrayList<FrameInterval.Frame>();
        for (int i = 0; i < 16; i++) frames.add(frame(i * 200L, i % 2 == 0 ? UPRIGHT : shifted));
        // 사람 없음·판정 불가·흐린 어깨는 평균에 넣지 않는다.
        var blurred = new double[9][];
        for (int i = 0; i < 9; i++) blurred[i] = UPRIGHT[i].clone();
        blurred[0][0] = 0.9;
        blurred[7][2] = 0.3;
        frames.add(frame(3200, null));
        frames.add(new FrameInterval.Frame(3300, null, false));
        frames.add(frame(3400, blurred));
        var mean = BaselineFrames.mean(frames);
        assertEquals(0.525, mean.nose().x(), EPSILON);
        assertEquals(0.47, mean.nose().y(), EPSILON);
        assertEquals(0.615, mean.rightShoulder().y(), EPSILON);
    }

    @Test
    void rejectionReasonsInOrder() {
        assertEquals("incomplete", reason(List.of()));
        assertEquals("incomplete", reason(capture(30, 2999, UPRIGHT)));
        // 3초는 넘었지만 판정 가능 프레임이 15장 미만이면 시간보다 장수가 사유다.
        assertEquals("too_few_frames", reason(capture(14, 3000, UPRIGHT)));
        assertEquals(15, BaselineFrames.MIN_FRAMES);
        BaselineFrames.mean(capture(15, 3000, UPRIGHT));

        var outside = new double[9][];
        for (int i = 0; i < 9; i++) outside[i] = UPRIGHT[i].clone();
        outside[5][0] = 1.2; // 입 왼쪽이 화면 밖으로 추정됨(판정 프레임으로는 쓸 수 있다)
        assertEquals("out_of_frame", reason(capture(20, 3000, outside)));
    }

    @Test
    void framesMustMoveForward() {
        var frames = new ArrayList<>(capture(20, 3000, UPRIGHT));
        frames.set(5, frame(frames.get(4).tMs(), UPRIGHT));
        var error = assertThrows(ApiError.class, () -> BaselineFrames.mean(frames));
        assertEquals(400, error.status());
    }
}
