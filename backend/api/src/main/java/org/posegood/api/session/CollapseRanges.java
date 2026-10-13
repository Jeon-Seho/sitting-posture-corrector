package org.posegood.api.session;

import org.posegood.api.engine.ExcludedSpan;
import java.util.ArrayList;
import java.util.List;

/** V2.3 BR-20/BR-53: elapsed sessions >= 5 minutes, excluding every unmeasured interval. */
final class CollapseRanges {
    record Period(long startMs, long endMs) {}
    record Range(long minMs, long maxMs) {}
    private CollapseRanges() {}

    static Range calculate(long totalMs, List<Period> episodes, List<ExcludedSpan> excluded) {
        if (totalMs < 300_000) return null;
        var samples = new ArrayList<Long>();
        long cursor = 0;
        for (var episode : episodes) {
            samples.add(valid(cursor, episode.startMs(), excluded));
            cursor = episode.endMs();
        }
        if (cursor < totalMs || episodes.isEmpty()) samples.add(valid(cursor, totalMs, excluded));
        return samples.isEmpty() ? null : new Range(samples.stream().mapToLong(Long::longValue).min().orElseThrow(),
                samples.stream().mapToLong(Long::longValue).max().orElseThrow());
    }

    private static long valid(long start, long end, List<ExcludedSpan> spans) {
        long duration = end - start;
        for (var span : spans) duration -= Math.max(0, Math.min(end, span.endMs()) - Math.max(start, span.startMs()));
        return Math.max(0, duration);
    }
}
