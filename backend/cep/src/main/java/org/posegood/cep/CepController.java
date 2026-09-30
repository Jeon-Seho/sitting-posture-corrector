package org.posegood.cep;
import org.posegood.contracts.*;
import org.springframework.web.bind.annotation.*;
import jakarta.annotation.PreDestroy;
import jakarta.validation.Valid;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/internal/sessions")
public class CepController {
    private final Map<UUID,SessionEngine> sessions=new ConcurrentHashMap<>();
    @PutMapping("/{id}")
    public synchronized SessionView create(@PathVariable UUID id,@Valid @RequestBody CreateSession request) {
        var existing=sessions.get(id);
        if (existing!=null) {
            if (!existing.view().policy().equals(request.policy())) throw new ContractError(409,"policy already frozen");
            return existing.view();
        }
        if (sessions.size()>=64) throw new ContractError(429,"development session limit reached");
        var engine=new SessionEngine(id,request.policy()); sessions.put(id,engine); return engine.view();
    }
    private SessionEngine engine(UUID id) {
        var engine=sessions.get(id); if (engine==null) throw new ContractError(404,"session not found"); return engine;
    }
    @PostMapping("/{id}/observations")
    public SessionView observe(@PathVariable UUID id,@Valid @RequestBody Observation observation) { return engine(id).accept(observation); }
    @PostMapping("/{id}/end")
    public SessionView end(@PathVariable UUID id,@Valid @RequestBody EndSession request) { return engine(id).end(request.endMs()); }
    @GetMapping("/{id}") public SessionView get(@PathVariable UUID id) { return engine(id).view(); }
    @PreDestroy public void close() { sessions.values().forEach(SessionEngine::close); }
}
