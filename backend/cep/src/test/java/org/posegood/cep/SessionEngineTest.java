package org.posegood.cep;

import org.junit.jupiter.api.*;
import org.posegood.contracts.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Hand-authored synthetic outputs, independent of LSTM or any participant. */
class SessionEngineTest {
    private SessionEngine engine;
    private long sequence;
    @BeforeEach void setup() { engine=new SessionEngine(UUID.randomUUID(),Policy.defaults()); sequence=0; }
    @AfterEach void close() { engine.close(); }
    private Observation obs(long seq,long from,long to,double p,boolean valid,Observation.Phase phase) {
        return new Observation("2.0",seq,from,to,phase,valid,p,Observation.DeviationType.forward_slouch,"synthetic-v1");
    }
    private SessionView feed(long from,long to,double probability) { return phase(from,to,probability,true,Observation.Phase.running); }
    private SessionView phase(long from,long to,double p,boolean valid,Observation.Phase phase) {
        var result=engine.view();
        while (from<to) { long next=Math.min(to,from+1000); result=engine.accept(obs(sequence++,from,next,p,valid,phase)); from=next; }
        return result;
    }
    private long count(String kind) { return engine.view().events().stream().filter(e->e.kind().equals(kind)).count(); }

    @Test void threeSecondBeforeExactAfterAndFirstAlertOnce() {
        assertEquals(0,feed(0,2999,.9).summary().collapseCount());
        assertEquals(1,feed(2999,3000,.9).summary().collapseCount());
        assertEquals(1,feed(3000,3001,.9).summary().alertCount());
        assertEquals(1,count("collapse_confirmed"));
        assertEquals(3000,engine.view().events().getFirst().timestampMs());
    }
    @Test void separateTwoPointNineSecondRunsNeverSum() {
        feed(0,2900,.9); feed(2900,3000,.1); feed(3000,5900,.9);
        assertEquals(0,engine.view().summary().collapseCount());
    }
    @Test void reminderSixtySecondBoundary() {
        feed(0,62999,.9); assertEquals(1,engine.view().summary().alertCount());
        feed(62999,63000,.9); assertEquals(2,engine.view().summary().alertCount());
        feed(63000,63001,.9); assertEquals(2,engine.view().summary().alertCount());
        assertEquals(1,count("reminder"));
    }
    @Test void recoveryBoundaryAndReturnToDeviationReset() {
        feed(0,3000,.9); feed(3000,4999,.1); assertEquals(0,count("recovery_confirmed"));
        feed(4999,5000,.1); assertEquals(1,count("recovery_confirmed"));
        assertEquals(2000,engine.view().summary().meanRecoveryMs());
    }
    @Test void interruptedRecoveryDoesNotSum() {
        feed(0,3000,.9); feed(3000,4900,.1); feed(4900,5000,.9); feed(5000,6900,.1);
        assertEquals(0,count("recovery_confirmed"));
        feed(6900,7000,.1); assertEquals(1,count("recovery_confirmed"));
    }
    @Test void customFrozenTimesAndThresholdAreApplied() {
        engine.close(); engine=new SessionEngine(UUID.randomUUID(),new Policy(4000,3500,7000,.8));
        feed(0,1000,.75); feed(1000,4999,.9); assertEquals(0,count("collapse_confirmed"));
        feed(4999,5000,.9); assertEquals(1,count("collapse_confirmed"));
        feed(5000,11999,.9); assertEquals(1,engine.view().summary().alertCount());
        feed(11999,12000,.9); assertEquals(2,engine.view().summary().alertCount());
        feed(12000,15499,.1); assertEquals(0,count("recovery_confirmed"));
        feed(15499,15500,.1); assertEquals(1,count("recovery_confirmed"));
    }
    @Test void restExcludedFromIntervalAcrossSameSession() {
        feed(0,3000,.9); feed(3000,5000,.1);
        phase(5000,15000,.9,true,Observation.Phase.rest);
        feed(15000,18000,.9);
        var stats=engine.view().summary();
        assertEquals(10000,stats.restMs()); assertEquals(8000,stats.validMs());
        assertEquals(5000,stats.meanIntervalMs()); assertEquals(1,stats.intervalCount());
        assertEquals(900,stats.eventsPerHour()); assertEquals(.25,stats.keepRate());
    }
    @Test void awayPoorAndMissingExcludedAndNotRecovered() {
        feed(0,3000,.9); phase(3000,6000,.9,true,Observation.Phase.away);
        phase(6000,9000,.9,false,Observation.Phase.running);
        feed(12000,15000,.9);
        var stats=engine.view().summary();
        assertEquals(3000,stats.awayMs()); assertEquals(3000,stats.unknownMs()); assertEquals(3000,stats.missingMs());
        assertEquals(6000,stats.validMs()); assertEquals(3000,stats.meanIntervalMs());
        assertNull(stats.meanRecoveryMs()); assertEquals(0,count("recovery_confirmed"));
        assertEquals(stats.totalMs(),stats.validMs()+stats.awayMs()+stats.unknownMs()+stats.missingMs()+stats.restMs());
    }
    @Test void missingBreaksCandidateAndDoesNotBecomeNormal() {
        feed(0,2900,.9); feed(6000,8900,.9);
        assertEquals(0,count("collapse_confirmed")); assertEquals(3100,engine.view().summary().missingMs());
        assertEquals(0,engine.view().summary().normalMs());
    }
    @Test void missingSequenceBreaksCandidateWithoutInventingDuration() {
        engine.accept(obs(0,0,1500,.9,true,Observation.Phase.running));
        engine.accept(obs(2,1500,3000,.9,true,Observation.Phase.running));
        assertEquals(0,count("collapse_confirmed")); assertEquals(0,engine.view().summary().missingMs());
    }
    @Test void validZeroAndSingleEventHaveUnavailableStatistics() {
        phase(0,3000,.9,true,Observation.Phase.rest);
        var s=engine.view().summary(); assertNull(s.keepRate()); assertNull(s.eventsPerHour()); assertNull(s.meanIntervalMs());
        feed(3000,6000,.9); assertNull(engine.view().summary().meanIntervalMs());
    }
    @Test void duplicateIdempotentConflictOutOfOrderAndOverlapDoNotMutate() {
        var first=obs(0,0,1000,.9,true,Observation.Phase.running); var before=engine.accept(first);
        assertEquals(before,engine.accept(first));
        assertThrows(ContractError.class,()->engine.accept(obs(0,0,1000,.1,true,Observation.Phase.running)));
        assertThrows(ContractError.class,()->engine.accept(obs(-1,1000,2000,.9,true,Observation.Phase.running)));
        assertThrows(ContractError.class,()->engine.accept(obs(1,999,1500,.9,true,Observation.Phase.running)));
        assertEquals(before,engine.view());
    }
    @Test void sessionBoundaryNeverProducesCycleIntervalOrCarryOverCandidate() {
        feed(0,3000,.9); engine.end(3000);
        try(var second=new SessionEngine(UUID.randomUUID(),Policy.defaults())) {
            second.accept(obs(0,0,1000,.9,true,Observation.Phase.running));
            assertEquals(0,second.view().summary().collapseCount()); assertNull(second.view().summary().meanIntervalMs());
        }
    }
    @Test void endIsIdempotentAndDoesNotPretendRecovery() {
        feed(0,3000,.9); var result=engine.end(3000); assertEquals(result,engine.end(3000));
        assertThrows(ContractError.class,()->engine.end(2999));
        assertThrows(ContractError.class,()->engine.accept(obs(sequence,3000,4000,.9,true,Observation.Phase.running)));
        assertEquals(0,count("recovery_confirmed")); assertEquals(1,count("session_ended")); assertEquals(result,engine.view());
    }
    @Test void concurrentRetriesAreExactlyOnce() throws Exception {
        feed(0,2000,.9); var input=obs(sequence,2000,3000,.9,true,Observation.Phase.running);
        try(var pool=Executors.newFixedThreadPool(4)) {
            var futures=new ArrayList<Future<SessionView>>();
            for(int i=0;i<12;i++) futures.add(pool.submit(()->engine.accept(input)));
            for(var future:futures) assertEquals(1,future.get().summary().collapseCount());
        }
        assertEquals(3000,engine.view().summary().validMs()); assertEquals(1,engine.view().summary().alertCount());
    }
    @Test void invalidNumericInputsNeverReachCep() {
        assertThrows(IllegalArgumentException.class,()->obs(0,0,1000,Double.NaN,true,Observation.Phase.running));
        assertThrows(IllegalArgumentException.class,()->obs(0,1000,1000,.9,true,Observation.Phase.running));
        assertThrows(IllegalArgumentException.class,()->obs(0,0,1501,.9,true,Observation.Phase.running));
    }
}
