package org.posegood.api.session;

import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.DoubleFunction;

/**
 * 서버가 모은 좌표 구간 묶음(계획 0064): 추론 v3 요청, 프레임별 결과 → 판정 엔진의 구간 조각, 앱에 보낼 관측 4.0.
 *
 * 프레임 하나는 찍힌 시각부터 다음 프레임이 찍힐 때까지를 맡는다(구간의 첫 프레임은 구간 시작부터). 시간은 프레임
 * {@code t_ms}(앱 시계)로 센다. 한 프레임이 맡는 판정 시간은 0.5초까지이고(앱이 새 프레임 없이 구간을 닫는 길이와
 * 같음), 넘는 부분과 프레임이 없는 구간은 판정 불가다. 그래서 {@code valid_ms}는 판별 가능한 프레임 시간의 합이다.
 */
final class FrameBatch {
    /** 프레임 하나가 맡을 수 있는 가장 긴 판정 시간. */
    static final long MAX_FRAME_MS = 500;

    private final List<FrameInterval> intervals;
    /** 구간마다 찍힌 순서로 정렬한 프레임(running 구간만, 그 밖에는 빈 목록). */
    private final List<List<FrameInterval.Frame>> frames;

    FrameBatch(List<FrameInterval> intervals) {
        this.intervals = List.copyOf(intervals);
        this.frames =
                intervals.stream()
                        .map(interval ->
                                interval.phase() == FrameInterval.Phase.running
                                        ? interval.frames().stream()
                                                .sorted(Comparator.comparingLong(FrameInterval.Frame::tMs))
                                                .toList()
                                        : List.<FrameInterval.Frame>of())
                        .toList();
    }

    boolean isEmpty() {
        return intervals.isEmpty();
    }

    /** 추론에 넘길 프레임이 있는지(쉬기·자리 비움·빈 구간뿐이면 부르지 않는다). */
    boolean needsInference() {
        return frames.stream().anyMatch(list -> !list.isEmpty());
    }

    FrameInference.Request request(SessionRequests.Landmarks baseline) {
        var all = frames.stream().flatMap(List::stream).map(FrameInference.Frame::of).toList();
        return FrameInference.Request.of(baseline, all);
    }

    /** 구간마다 판정 엔진에 넣을 조각. {@code results}는 {@link #request} 프레임 순서의 결과다. */
    List<List<Observation>> parts(List<FrameInference.Result> results, String modelVersion) {
        var out = new ArrayList<List<Observation>>(intervals.size());
        int offset = 0;
        for (int index = 0; index < intervals.size(); index++) {
            int count = frames.get(index).size();
            out.add(parts(intervals.get(index), results.subList(offset, offset + count), modelVersion));
            offset += count;
        }
        return out;
    }

    static List<Observation> parts(FrameInterval interval, List<FrameInference.Result> results, String modelVersion) {
        var phase = Observation.Phase.valueOf(interval.phase().name());
        long start = interval.startMs(), end = interval.endMs();
        var parts = new ArrayList<Observation>();
        if (interval.phase() != FrameInterval.Phase.running || results.isEmpty()) {
            parts.add(unjudged(interval.sequence(), start, end, phase, modelVersion));
            return parts;
        }
        long from = start;
        for (int index = 0; index < results.size(); index++) {
            var result = results.get(index);
            long to = index + 1 < results.size() ? clamp(results.get(index + 1).tMs(), start, end) : end;
            if (to <= from) continue; // 같은 시각에 찍힌 프레임은 마지막 것만 시간을 맡는다
            long judged = Math.min(to, Math.max(from, clamp(result.tMs(), start, end)) + MAX_FRAME_MS);
            add(parts, result.valid()
                    ? new Observation("2.0", interval.sequence(), from, judged, phase, true,
                            result.collapseProbability(), result.deviationType(), modelVersion)
                    : unjudged(interval.sequence(), from, judged, phase, modelVersion));
            if (judged < to) add(parts, unjudged(interval.sequence(), judged, to, phase, modelVersion));
            from = to;
        }
        return parts;
    }

    /**
     * 앱에 보낼 관측 4.0: 묶음의 마지막 판정 가능 프레임. 없으면 고개 돌림만 있었을 때 {@code head_turn}, 아니면
     * {@code unmeasurable}.
     */
    static Observation.V4 live(List<FrameInference.Result> results, DoubleFunction<String> posture) {
        boolean turned = false;
        for (int index = results.size() - 1; index >= 0; index--) {
            var result = results.get(index);
            if (result.valid())
                return Observation.V4.judged(posture.apply(result.collapseProbability()), result.collapseProbability());
            turned |= "head_turn".equals(result.invalidReason());
        }
        return Observation.V4.unjudged(turned ? "head_turn" : "unmeasurable");
    }

    /** 판정 불가 조각이 이어지면 하나로 합친다(엔진은 같은 결과를 낸다). */
    private static void add(List<Observation> parts, Observation part) {
        int last = parts.size() - 1;
        if (last >= 0 && !part.valid() && !parts.get(last).valid() && parts.get(last).endMs() == part.startMs()) {
            var previous = parts.get(last);
            parts.set(last, unjudged(previous.sequence(), previous.startMs(), part.endMs(), previous.phase(),
                    previous.modelVersion()));
        } else {
            parts.add(part);
        }
    }

    private static Observation unjudged(long sequence, long start, long end, Observation.Phase phase, String model) {
        return new Observation("2.0", sequence, start, end, phase, false, 0, Observation.DeviationType.none, model);
    }

    private static long clamp(long value, long low, long high) {
        return Math.max(low, Math.min(high, value));
    }
}
