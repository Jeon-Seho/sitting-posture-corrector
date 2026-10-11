package org.posegood.api.engine;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.Summary;

import java.util.ArrayList;
import java.util.List;

/** Accumulates observed time and the continuity counters. It never compares them with the policy. */
final class Timeline {
    private long endMs;
    private long validMs;
    private long normalMs;
    private long deviationMs;
    private long restMs;
    private long awayMs;
    private long unknownMs;
    private long missingMs;
    private long holdMs;
    private long recoveryMs;
    private long onsetMs;
    private long onsetValidMs;
    private final List<ExcludedSpan> excluded = new ArrayList<>();

    void addMeasured(Observation observation, boolean candidate) {
        long duration = observation.endMs() - observation.startMs();
        endMs = observation.endMs();
        if (candidate && holdMs == 0) {
            onsetMs = observation.startMs();
            onsetValidMs = validMs;
        }
        validMs += duration;
        if (candidate) {
            deviationMs += duration;
            holdMs += duration;
            recoveryMs = 0;
        } else {
            normalMs += duration;
            holdMs = 0;
            recoveryMs += duration;
        }
    }

    void addExcluded(Observation observation) {
        long duration = observation.endMs() - observation.startMs();
        endMs = observation.endMs();
        ExcludedSpan.Reason reason =
                switch (observation.phase()) {
                    case rest -> {
                        restMs += duration;
                        yield ExcludedSpan.Reason.PAUSE;
                    }
                    case away -> {
                        awayMs += duration;
                        yield ExcludedSpan.Reason.ABSENCE;
                    }
                    case running -> {
                        unknownMs += duration;
                        yield ExcludedSpan.Reason.UNMEASURABLE;
                    }
                };
        exclude(observation.startMs(), observation.endMs(), reason);
    }

    /** A timestamp gap: excluded time that is never filled with normal or deviation. */
    void addMissing(long until) {
        if (until <= endMs) return;
        missingMs += until - endMs;
        exclude(endMs, until, ExcludedSpan.Reason.MISSING);
        endMs = until;
    }

    void resetContinuity() {
        holdMs = 0;
        recoveryMs = 0;
    }

    void resetRecovery() {
        recoveryMs = 0;
    }

    private void exclude(long from, long to, ExcludedSpan.Reason reason) {
        int last = excluded.size() - 1;
        if (last >= 0
                && excluded.get(last).reason() == reason
                && excluded.get(last).endMs() == from) {
            excluded.set(last, new ExcludedSpan(excluded.get(last).startMs(), to, reason));
        } else {
            excluded.add(new ExcludedSpan(from, to, reason));
        }
    }

    long endMs() {
        return endMs;
    }

    long validMs() {
        return validMs;
    }

    long normalMs() {
        return normalMs;
    }

    long holdMs() {
        return holdMs;
    }

    long recoveryMs() {
        return recoveryMs;
    }

    long onsetMs() {
        return onsetMs;
    }

    long onsetValidMs() {
        return onsetValidMs;
    }

    List<ExcludedSpan> excluded() {
        return List.copyOf(excluded);
    }

    Summary summary(EpisodeLedger.Statistics episodes) {
        return new Summary(
                endMs,
                validMs,
                normalMs,
                deviationMs,
                restMs,
                awayMs,
                unknownMs,
                missingMs,
                episodes.collapseCount(),
                episodes.alertCount(),
                episodes.intervalCount(),
                validMs == 0 ? null : (double) normalMs / validMs,
                validMs == 0 ? null : episodes.collapseCount() * 3_600_000.0 / validMs,
                episodes.meanIntervalMs(),
                episodes.meanRecoveryMs());
    }
}
