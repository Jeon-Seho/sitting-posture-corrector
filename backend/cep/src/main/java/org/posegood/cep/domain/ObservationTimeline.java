package org.posegood.cep.domain;

import org.posegood.contracts.Observation;
import org.posegood.contracts.Summary;

/** Accumulates observed time. Temporal policy comparisons belong exclusively to EPL. */
public final class ObservationTimeline {
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

    public void addMeasured(Observation observation, boolean candidate) {
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

    public void addExcluded(Observation observation) {
        long duration = observation.endMs() - observation.startMs();
        endMs = observation.endMs();
        switch (observation.phase()) {
            case rest -> restMs += duration;
            case away -> awayMs += duration;
            case running -> unknownMs += duration;
        }
    }

    public void addMissing(long duration) {
        missingMs += duration;
    }

    public void advanceTo(long at) {
        endMs = at;
    }

    public void resetContinuity() {
        holdMs = 0;
        recoveryMs = 0;
    }

    public void resetRecovery() {
        recoveryMs = 0;
    }

    public long endMs() {
        return endMs;
    }

    public long validMs() {
        return validMs;
    }

    public long holdMs() {
        return holdMs;
    }

    public long recoveryMs() {
        return recoveryMs;
    }

    public long onsetMs() {
        return onsetMs;
    }

    public long onsetValidMs() {
        return onsetValidMs;
    }

    public Summary summary(EpisodeLedger.Statistics episodes) {
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
                validMs == 0 ? null : (double) normalMs / validMs,
                validMs == 0 ? null : episodes.collapseCount() * 3_600_000.0 / validMs,
                episodes.intervalCount(),
                episodes.meanIntervalMs(),
                episodes.meanRecoveryMs());
    }
}
