package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;

import java.util.List;

/**
 * 자세 등록(B1) 프레임 배열 → 관절 9개 평균 좌표(2026-10-28 사용자 결정, 계획 0060 — FE ADR 0021 5절 「앱이 평균」을 바꿈).
 *
 * 판정 가능 프레임(BE 명세 11.3)의 x·y만 단순 평균한다. 촬영 시간은 앱이 보낸 값이 아니라 {@code t_ms}로 센다.
 * 좌표 원본은 계산 뒤 버린다(DB에는 평균만). 1초 넘는 빈틈은 앱만 거절하고 서버는 보지 않는다.
 */
public final class BaselineFrames {
    /** 첫 프레임부터 마지막 프레임까지 최소 시간(2026-10-06 사용자 결정). */
    static final long MIN_MS = 3000;
    /** 판정 가능 프레임 최소 장수. */
    static final int MIN_FRAMES = 15;
    /** 한 번에 받는 최대 프레임 수(요청 검증 {@code @Size}와 같다). */
    public static final int MAX_FRAMES = 500;

    private BaselineFrames() {}

    /**
     * 평균 좌표. 기준을 만들 수 없으면 422 {@code BASELINE_REJECTED}이고 순서대로
     * {@code incomplete}(3초 미만) → {@code too_few_frames}(판정 가능 15장 미만) →
     * {@code out_of_frame}(평균이 0~1 밖이거나 그 평균으로 특징을 못 구함)이다.
     * {@code t_ms}가 늘어나지 않으면 400이다.
     */
    public static SessionRequests.Landmarks mean(List<FrameInterval.Frame> frames) {
        for (int index = 1; index < frames.size(); index++)
            if (frames.get(index).tMs() <= frames.get(index - 1).tMs())
                throw ApiError.badRequest("frames must be in increasing t_ms");
        if (frames.isEmpty() || frames.get(frames.size() - 1).tMs() - frames.get(0).tMs() < MIN_MS)
            throw ApiError.baselineRejected("incomplete");
        var sums = new double[FrameInterval.JOINTS * 2];
        int count = 0;
        for (var frame : frames) {
            if (!FrameFeatures.usable(frame)) continue;
            count++;
            for (int index = 0; index < FrameInterval.JOINTS; index++) {
                var joint = frame.joint(index);
                sums[index * 2] += joint[0];
                sums[index * 2 + 1] += joint[1];
            }
        }
        if (count < MIN_FRAMES) throw ApiError.baselineRejected("too_few_frames");
        var points = new SessionRequests.Point[FrameInterval.JOINTS];
        for (int index = 0; index < points.length; index++) {
            double x = sums[index * 2] / count, y = sums[index * 2 + 1] / count;
            if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw ApiError.baselineRejected("out_of_frame");
            points[index] = new SessionRequests.Point(x, y);
        }
        var landmarks = new SessionRequests.Landmarks(
                points[0], points[1], points[2], points[3], points[4], points[5], points[6], points[7], points[8]);
        if (FrameFeatures.baseline(landmarks) == null) throw ApiError.baselineRejected("out_of_frame");
        return landmarks;
    }
}
