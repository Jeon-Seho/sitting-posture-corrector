package org.posegood.api.session;

import org.junit.jupiter.api.Test;
import org.posegood.api.engine.ExcludedSpan;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.posegood.api.engine.ExcludedSpan.Reason.*;

class CollapseRangesTest {
    @Test void excludesShortSessionsAndIncludesTheFiveMinuteBoundary() {
        assertNull(CollapseRanges.calculate(299999, List.of(), List.of()));
        assertEquals(new CollapseRanges.Range(300000, 300000), CollapseRanges.calculate(300000, List.of(), List.of()));
    }

    @Test void countsInitialAndTerminalSegmentsAndSubtractsIntersectingExclusions() {
        var episodes = List.of(new CollapseRanges.Period(100000, 150000), new CollapseRanges.Period(250000, 270000));
        var excluded = List.of(new ExcludedSpan(20000, 40000, PAUSE), new ExcludedSpan(140000, 180000, UNMEASURABLE),
                new ExcludedSpan(290000, 300000, MISSING));
        assertEquals(new CollapseRanges.Range(20000, 80000), CollapseRanges.calculate(300000, episodes, excluded));
    }

    @Test void countsAnImmediateCollapseButDoesNotInventATerminalInterval() {
        assertEquals(new CollapseRanges.Range(0, 0), CollapseRanges.calculate(300000,
                List.of(new CollapseRanges.Period(0, 300000)), List.of()));
    }
}
