package org.posegood.api.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;

import java.util.ArrayList;
import java.util.List;

/**
 * 판정 엔진 묶음(계획 0064)의 프레임 시간 나누기와 관측 4.0. 합성 결과만 쓴다.
 */
class FramePartsTest {
    private static final String MODEL = "synthetic-v1";

    private static FrameInference.Result judged(long t, double score) {
        return new FrameInference.Result(t, true, score, Observation.DeviationType.left_lean, null);
    }

    private static FrameInference.Result unjudged(long t, String reason) {
        return new FrameInference.Result(t, false, 0, Observation.DeviationType.none, reason);
    }

    private static FrameInterval running(long sequence, long start, long end, long... times) {
        var frames = new ArrayList<FrameInterval.Frame>();
        for (long t : times) frames.add(new FrameInterval.Frame(t, null, null));
        return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, end, FrameInterval.Phase.running, frames);
    }

    /** 조각을 [시작, 끝, 유효] 목록으로. */
    private static List<List<Long>> spans(List<Observation> parts) {
        return parts.stream().map(p -> List.of(p.startMs(), p.endMs(), p.valid() ? 1L : 0L)).toList();
    }

    @Test
    void eachFrameCoversUntilTheNextFrameFromTheIntervalStart() {
        var parts = FrameParts.parts(running(3, 1000, 1400, 1050, 1200),
                List.of(judged(1050, 0.9), judged(1200, 0.2)), MODEL);
        assertEquals(List.of(List.of(1000L, 1200L, 1L), List.of(1200L, 1400L, 1L)), spans(parts));
        assertEquals(0.9, parts.get(0).collapseProbability());
        assertEquals(Observation.DeviationType.left_lean, parts.get(0).deviationType());
        assertTrue(parts.stream().allMatch(part -> part.sequence() == 3));
    }

    @Test
    void aFrameCoversAtMostHalfASecondAndUnjudgedPiecesMerge() {
        var parts = FrameParts.parts(running(0, 0, 1500, 0, 100),
                List.of(unjudged(0, "unmeasurable"), judged(100, 0.1)), MODEL);
        // 0~100 판정 불가, 100~600 판정, 600~1500 판정 불가.
        assertEquals(List.of(List.of(0L, 100L, 0L), List.of(100L, 600L, 1L), List.of(600L, 1500L, 0L)), spans(parts));
        var lateGap = FrameParts.parts(running(0, 0, 1500, 0, 1200),
                List.of(unjudged(0, "unmeasurable"), unjudged(1200, "unmeasurable")), MODEL);
        assertEquals(List.of(List.of(0L, 1500L, 0L)), spans(lateGap));
    }

    @Test
    void framesAtTheSameTimeOrOutsideTheIntervalStayInside() {
        var parts = FrameParts.parts(running(0, 500, 1000, 400, 700, 700, 2000),
                List.of(judged(400, 0.1), judged(700, 0.2), judged(700, 0.3), judged(2000, 0.4)), MODEL);
        // 400은 시작(500)으로, 2000은 끝(1000)으로 당긴다. 같은 시각 700의 앞 프레임과 끝에 닿은 프레임은 시간을 맡지 않는다.
        assertEquals(List.of(List.of(500L, 700L, 1L), List.of(700L, 1000L, 1L)), spans(parts));
        assertEquals(0.3, parts.get(1).collapseProbability());
    }

    @Test
    void restAwayAndEmptyIntervalsAreOneUnjudgedPiece() {
        var rest = new FrameInterval("3.0", "keypoints-9-v1", 1, 500, 1000, FrameInterval.Phase.rest,
                List.of(new FrameInterval.Frame(600, null, null)));
        // 쉬기·자리 비움·빈 구간은 추론할 프레임이 없다.
        assertTrue(FrameParts.frames(rest).isEmpty());
        assertTrue(FrameParts.frames(running(0, 0, 500)).isEmpty());
        assertEquals(List.of(List.of(0L, 500L, 0L)), spans(FrameParts.parts(running(0, 0, 500), List.of(), MODEL)));
        var parts = FrameParts.parts(rest, List.of(), MODEL);
        assertEquals(List.of(List.of(500L, 1000L, 0L)), spans(parts));
        assertEquals(Observation.Phase.rest, parts.get(0).phase());
    }

    @Test
    void framesToInferAreSortedByTheirTime() {
        var frames = FrameParts.frames(running(0, 0, 500, 300, 100, 200));
        assertEquals(List.of(100L, 200L, 300L), frames.stream().map(FrameInterval.Frame::tMs).toList());
    }

    @Test
    void liveIsTheLastJudgeableFrameOrSaysWhyNot() {
        assertEquals(new Observation.V4("4.0", true, "bad", 0.8, null),
                FrameParts.live(List.of(judged(0, 0.1), judged(100, 0.8), unjudged(200, "head_turn")),
                        score -> score >= 0.7 ? "bad" : "good"));
        assertEquals(Observation.V4.unjudged("head_turn"),
                FrameParts.live(List.of(unjudged(0, "unmeasurable"), unjudged(100, "head_turn")), score -> "good"));
        assertEquals(Observation.V4.unjudged("unmeasurable"), FrameParts.live(List.of(), score -> "good"));
    }
}
