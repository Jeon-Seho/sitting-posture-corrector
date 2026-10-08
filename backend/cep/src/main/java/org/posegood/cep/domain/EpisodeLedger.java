package org.posegood.cep.domain;

import org.posegood.contracts.DecisionEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Records accepted CEP decisions and derives episode statistics on the valid-time axis. */
public final class EpisodeLedger {
    private final UUID sessionId;
    private final List<DecisionEvent> events = new ArrayList<>();
    private Episode active;
    private Long previousOnsetValid;
    private long eventId;
    private long collapseCount;
    private long alerts;
    private long intervals;
    private long intervalSum;
    private long recoveries;
    private long recoverySum;

    public EpisodeLedger(UUID sessionId) {
        this.sessionId = sessionId;
    }

    public boolean active() {
        return active != null;
    }

    public long sinceAlertMs(long at) {
        return active == null ? 0 : at - active.lastAlert;
    }

    public void confirmCollapse(long at, long onset, long onsetValid, String type) {
        active = new Episode(onset, onsetValid, at, type);
        collapseCount++;
        alerts++;
        if (previousOnsetValid != null) {
            intervals++;
            intervalSum += onsetValid - previousOnsetValid;
        }
        previousOnsetValid = onsetValid;
        emit("collapse_confirmed", at, active, null);
    }

    public void remind(long at) {
        alerts++;
        active.lastAlert = at;
        emit("reminder", at, active, null);
    }

    public void confirmRecovery(long at) {
        recoveries++;
        recoverySum += at - active.firstAlert;
        emit("recovery_confirmed", at, active, null);
        active = null;
    }

    public void interrupt(String reason, long at) {
        if (active != null) {
            emit("interrupted", at, active, reason);
        }
        active = null;
    }

    public void end(long at, long validMs) {
        events.add(
                new DecisionEvent(
                        "1.0",
                        sessionId,
                        ++eventId,
                        "session_ended",
                        at,
                        at,
                        validMs,
                        "none",
                        "ended"));
    }

    public List<DecisionEvent> events() {
        return List.copyOf(events);
    }

    public Statistics statistics() {
        return new Statistics(
                collapseCount,
                alerts,
                intervals,
                intervals == 0 ? null : (double) intervalSum / intervals,
                recoveries == 0 ? null : (double) recoverySum / recoveries);
    }

    private void emit(String kind, long at, Episode episode, String reason) {
        events.add(
                new DecisionEvent(
                        "1.0",
                        sessionId,
                        ++eventId,
                        kind,
                        at,
                        episode.onset,
                        episode.onsetValid,
                        episode.type,
                        reason));
    }

    public record Statistics(
            long collapseCount,
            long alertCount,
            long intervalCount,
            Double meanIntervalMs,
            Double meanRecoveryMs) {}

    private static final class Episode {
        private final long onset;
        private final long onsetValid;
        private final long firstAlert;
        private final String type;
        private long lastAlert;

        private Episode(long onset, long onsetValid, long at, String type) {
            this.onset = onset;
            this.onsetValid = onsetValid;
            this.firstAlert = at;
            this.lastAlert = at;
            this.type = type;
        }
    }
}
