package org.posegood.cep;

import com.espertech.esper.common.client.EPCompiled;
import com.espertech.esper.common.client.configuration.Configuration;
import com.espertech.esper.compiler.client.*;
import com.espertech.esper.runtime.client.*;
import org.posegood.contracts.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Event-time accumulator plus Esper decisions. No wall-clock timers or model training. */
public final class SessionEngine implements AutoCloseable {
    private static Configuration configuration() {
        var c = new Configuration();
        c.getRuntime().getThreading().setInternalTimerEnabled(false);
        var fields = new HashMap<String,Object>();
        fields.put("candidate", Boolean.class); fields.put("active", Boolean.class);
        for (var name : List.of("holdMs", "holdThresholdMs", "recoveryMs", "recoveryThresholdMs",
                "sinceAlertMs", "reminderThresholdMs")) fields.put(name, Long.class);
        c.getCommon().addEventType("CepFrame", fields);
        return c;
    }
    private static final EPCompiled COMPILED = compile();
    private static EPCompiled compile() {
        try (var source = SessionEngine.class.getResourceAsStream("/rules/posture.epl")) {
            if (source == null) throw new IllegalStateException("missing EPL");
            return EPCompilerProvider.getCompiler().compile(new String(source.readAllBytes(), StandardCharsets.UTF_8),
                    new CompilerArguments(configuration()));
        } catch (Exception e) { throw new IllegalStateException("cannot compile CEP rules", e); }
    }

    private final UUID id;
    private final Policy policy;
    private final EPRuntime runtime;
    private final Map<Long,Observation> accepted = new HashMap<>();
    private final List<DecisionEvent> events = new ArrayList<>();
    private long lastSequence = -1, endMs, validMs, normalMs, deviationMs, restMs, awayMs, unknownMs, missingMs;
    private long holdMs, recoveryMs, onsetMs, onsetValidMs, collapseCount, alerts, eventId;
    private long intervals, intervalSum, recoveries, recoverySum;
    private Long previousOnsetValid;
    private Episode active;
    private boolean ended;
    private Observation current;
    private static final int MAX_OBSERVATIONS = 10000;
    private static final class Episode {
        final long onset, onsetValid, firstAlert;
        final String type;
        long lastAlert;
        Episode(long onset, long onsetValid, long at, String type) {
            this.onset=onset; this.onsetValid=onsetValid; this.firstAlert=at; this.lastAlert=at; this.type=type;
        }
    }

    public SessionEngine(UUID id, Policy policy) {
        this.id=id; this.policy=policy;
        runtime = EPRuntimeProvider.getRuntime("session-"+id+"-"+UUID.randomUUID(), configuration());
        try {
            var deployment=runtime.getDeploymentService().deploy(COMPILED);
            for (var statement : deployment.getStatements()) statement.addListener((newEvents, oldEvents, s, r) -> {
                if (newEvents != null) for (var event : newEvents) decide((String)event.get("kind"));
            });
        } catch (EPDeployException e) { runtime.destroy(); throw new IllegalStateException("cannot deploy CEP rules", e); }
    }

    public synchronized SessionView accept(Observation observation) {
        var duplicate=accepted.get(observation.sequence());
        if (duplicate != null) {
            if (!duplicate.equals(observation)) throw new ContractError(409,"conflicting duplicate");
            return view();
        }
        if (ended) throw new ContractError(409,"session ended");
        if (observation.sequence() <= lastSequence || observation.startMs() < endMs)
            throw new ContractError(409,"out-of-order or overlapping interval");
        if (accepted.size() >= MAX_OBSERVATIONS) throw new ContractError(429,"development observation limit reached");
        // Missing time is excluded, not guessed normal or deviation. Sequence holes also break continuity.
        if (observation.startMs() > endMs) {
            interrupt("missing",endMs);
            missingMs += observation.startMs()-endMs;
        } else if (lastSequence >= 0 && observation.sequence() != lastSequence+1) {
            interrupt("missing_sequence",endMs);
        }
        current=observation;
        var duration=observation.endMs()-observation.startMs();
        endMs=observation.endMs();
        if (observation.phase() != Observation.Phase.running || !observation.valid()) {
            interrupt(observation.phase()==Observation.Phase.running ? "unmeasurable" : observation.phase().name(),observation.startMs());
            if (observation.phase()==Observation.Phase.rest) restMs+=duration;
            else if (observation.phase()==Observation.Phase.away) awayMs+=duration;
            else unknownMs+=duration;
        } else {
            var candidate=observation.collapseProbability() >= policy.threshold();
            if (candidate && holdMs==0) { onsetMs=observation.startMs(); onsetValidMs=validMs; }
            validMs+=duration;
            if (candidate) { deviationMs+=duration; holdMs+=duration; recoveryMs=0; }
            else { normalMs+=duration; holdMs=0; recoveryMs+=duration; }
            // Accumulate durations here; Esper alone compares temporal policy thresholds.
            var frame = new HashMap<String,Object>();
            frame.put("candidate",candidate); frame.put("active",active!=null);
            frame.put("holdMs",holdMs); frame.put("holdThresholdMs",policy.holdMs());
            frame.put("recoveryMs",recoveryMs); frame.put("recoveryThresholdMs",policy.recoveryMs());
            frame.put("sinceAlertMs",active==null ? 0L : endMs-active.lastAlert);
            frame.put("reminderThresholdMs",policy.reminderMs());
            runtime.getEventService().sendEventMap(frame,"CepFrame");
        }
        accepted.put(observation.sequence(),observation); lastSequence=observation.sequence();
        return view();
    }

    private void decide(String kind) {
        switch (kind) {
            case "collapse_confirmed" -> {
                active=new Episode(onsetMs,onsetValidMs,endMs,current.deviationType().name());
                collapseCount++; alerts++;
                if (previousOnsetValid!=null) { intervals++; intervalSum+=onsetValidMs-previousOnsetValid; }
                previousOnsetValid=onsetValidMs;
                emit(kind,endMs,active,null);
            }
            case "reminder" -> { alerts++; active.lastAlert=endMs; emit(kind,endMs,active,null); }
            case "recovery_confirmed" -> {
                recoveries++; recoverySum+=endMs-active.firstAlert;
                emit(kind,endMs,active,null); active=null; recoveryMs=0;
            }
            default -> throw new IllegalStateException("unknown CEP decision");
        }
    }
    private void emit(String kind,long at,Episode episode,String reason) {
        events.add(new DecisionEvent("1.0",id,++eventId,kind,at,episode==null ? at : episode.onset,
                episode==null ? validMs : episode.onsetValid,episode==null ? "none" : episode.type,reason));
    }
    /** Preserve existing interrupt/reset behavior; this is not a newly decided pause/resume policy. */
    private void interrupt(String reason,long at) {
        if (active!=null) emit("interrupted",at,active,reason);
        active=null; holdMs=0; recoveryMs=0;
    }
    public synchronized SessionView end(long at) {
        if (ended) {
            if (at!=endMs) throw new ContractError(409,"conflicting session end");
            return view();
        }
        if (at<endMs) throw new ContractError(409,"end precedes last observation");
        if (at>endMs) { interrupt("missing",endMs); missingMs+=at-endMs; }
        interrupt("ended",endMs); endMs=at; ended=true;
        emit("session_ended",at,null,"ended");
        return view();
    }
    public synchronized SessionView view() {
        var summary=new Summary(endMs,validMs,normalMs,deviationMs,restMs,awayMs,unknownMs,missingMs,
                collapseCount,alerts,validMs==0 ? null : (double)normalMs/validMs,
                validMs==0 ? null : collapseCount*3600000.0/validMs,
                intervals,intervals==0 ? null : (double)intervalSum/intervals,
                recoveries==0 ? null : (double)recoverySum/recoveries);
        return new SessionView("1.0",id,policy,"legacy-interrupt-v1",ended,lastSequence,summary,List.copyOf(events));
    }
    @Override public void close() { runtime.destroy(); }
}
