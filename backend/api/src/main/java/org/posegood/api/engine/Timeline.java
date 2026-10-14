package org.posegood.api.engine;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.Summary;

import java.util.ArrayList;
import java.util.List;

/**
 * 시간 누적기: 유효·바른·이탈·제외 시간과 연속 지속 시간을 센다(정책 비교는 하지 않음).
 */
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

    /** 측정된 구간: 이탈 후보면 이탈 시간, 아니면 바른 시간에 더한다. */
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

    /** 측정 못 한 구간(휴식·자리 비움·판정 불가)을 제외 시간에 더한다. */
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

    /**
     * 입력 사이의 빈 시간은 누락으로 제외한다.
     *
     * 이 시간은 바른 자세나 이탈로 채우지 않는다.
     */
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

    /** 요약 통계 계산. */
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
