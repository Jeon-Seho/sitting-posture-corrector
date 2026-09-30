package org.posegood.api;
import org.posegood.contracts.*;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Development in-memory persistence only. No posture or duration decisions belong here. */
@Service
public class SessionRepository {
    private static final class Stored { SessionView view; Stored(SessionView view) { this.view=view; } }
    private final Map<UUID,Stored> sessions=new ConcurrentHashMap<>();
    private final CepGateway cep;
    public SessionRepository(CepGateway cep) { this.cep=cep; }
    public synchronized SessionView create(UUID id,CreateSession request) {
        var stored=sessions.get(id);
        if (stored!=null) {
            synchronized(stored) {
                if (!stored.view.policy().equals(request.policy())) throw new ContractError(409,"policy already frozen");
                return stored.view;
            }
        }
        if (sessions.size()>=64) throw new ContractError(429,"development session limit reached");
        var result=cep.create(id,request); requireIdentity(id,request.policy(),result);
        sessions.put(id,new Stored(result)); return result;
    }
    private Stored stored(UUID id) {
        var value=sessions.get(id); if (value==null) throw new ContractError(404,"session not found"); return value;
    }
    private void requireIdentity(UUID id,Policy policy,SessionView view) {
        if (view==null || !id.equals(view.sessionId()) || !policy.equals(view.policy())
                || !"1.0".equals(view.schemaVersion()) || !"legacy-interrupt-v1".equals(view.timerPolicy())
                || view.summary()==null || view.events()==null
                || view.events().stream().anyMatch(e->e==null || !id.equals(e.sessionId())))
            throw new ContractError(502,"CEP response contract mismatch");
    }
    public SessionView observe(UUID id,Observation observation) {
        var stored=stored(id); synchronized(stored) {
            var result=cep.observe(id,observation); requireIdentity(id,stored.view.policy(),result); stored.view=result; return result;
        }
    }
    public SessionView end(UUID id,EndSession request) {
        var stored=stored(id); synchronized(stored) {
            var result=cep.end(id,request); requireIdentity(id,stored.view.policy(),result); stored.view=result; return result;
        }
    }
    public SessionView get(UUID id) { var stored=stored(id); synchronized(stored) { return stored.view; } }
}
