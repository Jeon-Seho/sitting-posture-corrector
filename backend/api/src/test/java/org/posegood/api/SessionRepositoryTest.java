package org.posegood.api;
import org.junit.jupiter.api.Test;
import org.posegood.contracts.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class SessionRepositoryTest {
    private SessionView view(UUID id) { return new SessionView("1.0",id,Policy.defaults(),"legacy-interrupt-v1",false,-1,
            new Summary(0,0,0,0,0,0,0,0,0,0,null,null,0,null,null),List.of()); }
    private Observation input() { return new Observation("2.0",0,0,1000,Observation.Phase.running,true,.9,Observation.DeviationType.forward_slouch,"synthetic-v1"); }
    @Test void createsIdempotentlyAndFreezesPolicyWithoutLocalDecisions() {
        var gateway=mock(CepGateway.class); var repo=new SessionRepository(gateway); var id=UUID.randomUUID();
        var request=new CreateSession(Policy.defaults()); var output=view(id);
        when(gateway.create(id,request)).thenReturn(output);
        assertEquals(output,repo.create(id,request)); assertEquals(output,repo.create(id,request));
        assertThrows(ContractError.class,()->repo.create(id,new CreateSession(new Policy(4000,2000,60000,.7))));
        verify(gateway,times(1)).create(id,request); verifyNoMoreInteractions(gateway);
    }
    @Test void upstreamFailurePreservesSavedSnapshotAndRetryDelegates() {
        var gateway=mock(CepGateway.class); var repo=new SessionRepository(gateway); var id=UUID.randomUUID(); var initial=view(id);
        var request=new CreateSession(Policy.defaults()); when(gateway.create(id,request)).thenReturn(initial); repo.create(id,request);
        var input=input(); when(gateway.observe(id,input)).thenThrow(new ContractError(502,"unavailable")).thenReturn(initial);
        assertThrows(ContractError.class,()->repo.observe(id,input)); assertEquals(initial,repo.get(id));
        assertEquals(initial,repo.observe(id,input)); verify(gateway,times(2)).observe(id,input);
    }
    @Test void mismatchedSessionNeverReplacesStoredView() {
        var gateway=mock(CepGateway.class); var repo=new SessionRepository(gateway); var id=UUID.randomUUID(); var initial=view(id);
        var request=new CreateSession(Policy.defaults()); when(gateway.create(id,request)).thenReturn(initial); repo.create(id,request);
        when(gateway.observe(eq(id),any())).thenReturn(view(UUID.randomUUID()));
        assertThrows(ContractError.class,()->repo.observe(id,input())); assertEquals(initial,repo.get(id));
    }
    @Test void unknownSessionDoesNotCallCep() {
        var gateway=mock(CepGateway.class); var repo=new SessionRepository(gateway);
        assertThrows(ContractError.class,()->repo.observe(UUID.randomUUID(),input())); verifyNoInteractions(gateway);
    }
    @Test void concurrentCreationRetryWaitsForAcceptedSnapshot() throws Exception {
        var gateway=mock(CepGateway.class); var repo=new SessionRepository(gateway); var id=UUID.randomUUID();
        var request=new CreateSession(Policy.defaults()); var initial=view(id);
        when(gateway.create(id,request)).thenReturn(initial); repo.create(id,request);
        var accepted=new SessionView("1.0",id,Policy.defaults(),"legacy-interrupt-v1",false,0,
                new Summary(1000,1000,0,1000,0,0,0,0,0,0,0.0,0.0,0,null,null),List.of());
        var entered=new CountDownLatch(1); var release=new CountDownLatch(1);
        when(gateway.observe(eq(id),any())).thenAnswer(invocation->{ entered.countDown();
            if (!release.await(2,TimeUnit.SECONDS)) throw new AssertionError("test barrier timeout"); return accepted; });
        try(var pool=Executors.newFixedThreadPool(2)) {
            var observation=pool.submit(()->repo.observe(id,input()));
            assertTrue(entered.await(2,TimeUnit.SECONDS));
            var retry=pool.submit(()->repo.create(id,request));
            try { assertThrows(TimeoutException.class,()->retry.get(100,TimeUnit.MILLISECONDS)); }
            finally { release.countDown(); }
            assertEquals(accepted,observation.get(2,TimeUnit.SECONDS));
            assertEquals(accepted,retry.get(2,TimeUnit.SECONDS));
        }
    }
}
