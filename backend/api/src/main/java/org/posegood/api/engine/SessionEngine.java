package org.posegood.api.engine;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One session's deterministic decision state (ADR 0012, ADR 0020). Input order, duplicate and
 * gap handling, the interrupt/reset policy ({@code legacy-interrupt-v1}) and the statistics are the
 * former CEP behavior; {@link DecisionRules} holds the threshold comparisons.
 */
public final class SessionEngine {
    public static final int MAX_OBSERVATIONS = 10_000;

    private final UUID id;
    private final Policy policy;
    private final Timeline timeline = new Timeline();
    private final EpisodeLedger episodes;
    private final Map<Long, Observation> accepted = new HashMap<>();
    /** The summary right after each event, for realtime decision messages. */
    private final List<Summary> eventSummaries = new ArrayList<>();
    private long lastSequence = -1;
    private boolean ended;
    private Observation current;

    public SessionEngine(UUID id, Policy policy) {
        this.id = id;
        this.policy = policy;
        episodes = new EpisodeLedger(id);
    }

    public synchronized SessionView accept(Observation observation) {
        var duplicate = accepted.get(observation.sequence());
        if (duplicate != null) {
            if (!duplicate.equals(observation)) throw ApiError.conflict("conflicting duplicate");
            return view();
        }
        if (ended) throw ApiError.ended();
        if (observation.sequence() <= lastSequence || observation.startMs() < timeline.endMs())
            throw ApiError.conflict("out-of-order or overlapping interval");
        if (accepted.size() >= MAX_OBSERVATIONS)
            throw ApiError.limit("session observation limit reached");

        // Missing time is excluded. A sequence hole breaks continuity without inventing duration.
        if (observation.startMs() > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(observation.startMs());
        } else if (lastSequence >= 0 && observation.sequence() != lastSequence + 1) {
            interrupt("missing_sequence", timeline.endMs());
        }

        current = observation;
        if (observation.phase() != Observation.Phase.running || !observation.valid()) {
            String reason =
                    observation.phase() == Observation.Phase.running
                            ? "unmeasurable"
                            : observation.phase().name();
            interrupt(reason, observation.startMs());
            timeline.addExcluded(observation);
        } else {
            boolean candidate = observation.collapseProbability() >= policy.threshold();
            timeline.addMeasured(observation, candidate);
            apply(
                    DecisionRules.evaluate(
                            candidate,
                            episodes.active(),
                            timeline.holdMs(),
                            timeline.recoveryMs(),
                            episodes.sinceAlertMs(timeline.endMs()),
                            policy));
        }
        accepted.put(observation.sequence(), observation);
        lastSequence = observation.sequence();
        return view();
    }

    /** Ending twice with the same time is idempotent; another time is a conflict. */
    public synchronized SessionView end(long at) {
        if (ended) {
            if (at != timeline.endMs()) throw ApiError.conflict("conflicting session end");
            return view();
        }
        if (at < timeline.endMs()) throw ApiError.conflict("end precedes last observation");
        if (at > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(at);
        }
        interrupt("ended", timeline.endMs());
        ended = true;
        episodes.end(at, timeline.validMs());
        snapshot();
        return view();
    }

    public synchronized SessionView view() {
        return new SessionView(
                "1.0",
                id,
                policy,
                SessionView.TIMER_POLICY,
                ended,
                lastSequence,
                summary(),
                episodes.events());
    }

    public synchronized Summary summary() {
        return timeline.summary(episodes.statistics());
    }

    /** Events with an id greater than {@code eventId}, each with the summary at that point. */
    public synchronized List<Decided> eventsAfter(long eventId) {
        var result = new ArrayList<Decided>();
        for (int index = 0; index < episodes.size(); index++) {
            var event = episodes.event(index);
            if (event.eventId() > eventId) result.add(new Decided(event, eventSummaries.get(index)));
        }
        return result;
    }

    public synchronized List<ExcludedSpan> excluded() {
        return timeline.excluded();
    }

    public synchronized boolean ended() {
        return ended;
    }

    public synchronized long lastSequence() {
        return lastSequence;
    }

    public synchronized int acceptedCount() {
        return accepted.size();
    }

    public synchronized int eventCount() {
        return episodes.size();
    }

    public Policy policy() {
        return policy;
    }

    private void apply(DecisionRules.Decision decision) {
        switch (decision) {
            case NONE -> {
                return;
            }
            case COLLAPSE_CONFIRMED ->
                    episodes.confirmCollapse(
                            timeline.endMs(),
                            timeline.onsetMs(),
                            timeline.onsetValidMs(),
                            current.deviationType().name());
            case REMINDER -> episodes.remind(timeline.endMs());
            case RECOVERY_CONFIRMED -> {
                episodes.confirmRecovery(timeline.endMs());
                timeline.resetRecovery();
            }
        }
        snapshot();
    }

    /** Preserves the interrupt/reset policy; this is not a pause/resume of accumulated time. */
    private void interrupt(String reason, long at) {
        episodes.interrupt(reason, at);
        timeline.resetContinuity();
        snapshot();
    }

    private void snapshot() {
        while (eventSummaries.size() < episodes.size()) eventSummaries.add(summary());
    }

    public record Decided(DecisionEvent event, Summary summary) {}
}
