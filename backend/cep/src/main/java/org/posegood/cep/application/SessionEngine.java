package org.posegood.cep.application;

import org.posegood.cep.domain.EpisodeLedger;
import org.posegood.cep.domain.ObservationTimeline;
import org.posegood.cep.esper.EsperDecisionRuntime;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.Observation;
import org.posegood.contracts.Policy;
import org.posegood.contracts.SessionView;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Serializes one session's input, accumulation, and synchronous Esper decisions. */
public final class SessionEngine implements AutoCloseable {
    private static final int MAX_OBSERVATIONS = 10_000;

    private final UUID id;
    private final Policy policy;
    private final EsperDecisionRuntime rules;
    private final ObservationTimeline timeline = new ObservationTimeline();
    private final EpisodeLedger episodes;
    private final Map<Long, Observation> accepted = new HashMap<>();
    private long lastSequence = -1;
    private boolean ended;
    private Observation current;

    public SessionEngine(UUID id, Policy policy) {
        this.id = id;
        this.policy = policy;
        episodes = new EpisodeLedger(id);
        rules = new EsperDecisionRuntime(id, this::applyDecision);
    }

    public synchronized SessionView accept(Observation observation) {
        var duplicate = accepted.get(observation.sequence());
        if (duplicate != null) {
            if (!duplicate.equals(observation)) {
                throw new ContractError(409, "conflicting duplicate");
            }
            return view();
        }
        if (ended) {
            throw new ContractError(409, "session ended");
        }
        if (observation.sequence() <= lastSequence || observation.startMs() < timeline.endMs()) {
            throw new ContractError(409, "out-of-order or overlapping interval");
        }
        if (accepted.size() >= MAX_OBSERVATIONS) {
            throw new ContractError(429, "development observation limit reached");
        }

        // Missing time is excluded. Sequence holes break continuity without inventing duration.
        if (observation.startMs() > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(observation.startMs() - timeline.endMs());
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
            rules.evaluate(
                    new EsperDecisionRuntime.Frame(
                            candidate,
                            episodes.active(),
                            timeline.holdMs(),
                            policy.holdMs(),
                            timeline.recoveryMs(),
                            policy.recoveryMs(),
                            episodes.sinceAlertMs(timeline.endMs()),
                            policy.reminderMs()));
        }

        accepted.put(observation.sequence(), observation);
        lastSequence = observation.sequence();
        return view();
    }

    private void applyDecision(String kind) {
        switch (kind) {
            case "collapse_confirmed" ->
                    episodes.confirmCollapse(
                            timeline.endMs(),
                            timeline.onsetMs(),
                            timeline.onsetValidMs(),
                            current.deviationType().name());
            case "reminder" -> episodes.remind(timeline.endMs());
            case "recovery_confirmed" -> {
                episodes.confirmRecovery(timeline.endMs());
                timeline.resetRecovery();
            }
            default -> throw new IllegalStateException("unknown CEP decision");
        }
    }

    /** Preserves the existing interrupt/reset policy; this does not introduce pause/resume. */
    private void interrupt(String reason, long at) {
        episodes.interrupt(reason, at);
        timeline.resetContinuity();
    }

    public synchronized SessionView end(long at) {
        if (ended) {
            if (at != timeline.endMs()) {
                throw new ContractError(409, "conflicting session end");
            }
            return view();
        }
        if (at < timeline.endMs()) {
            throw new ContractError(409, "end precedes last observation");
        }
        if (at > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(at - timeline.endMs());
        }

        interrupt("ended", timeline.endMs());
        timeline.advanceTo(at);
        ended = true;
        episodes.end(at, timeline.validMs());
        return view();
    }

    public synchronized SessionView view() {
        return new SessionView(
                "1.0",
                id,
                policy,
                "legacy-interrupt-v1",
                ended,
                lastSequence,
                timeline.summary(episodes.statistics()),
                episodes.events());
    }

    @Override
    public void close() {
        rules.close();
    }
}
