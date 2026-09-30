package org.posegood.api;
import org.posegood.contracts.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.UUID;
@RestController
@RequestMapping("/v1/sessions")
public class SessionController {
    private final SessionRepository repository;
    public SessionController(SessionRepository repository) { this.repository=repository; }
    @PutMapping("/{id}") public SessionView create(@PathVariable UUID id,@Valid @RequestBody CreateSession request) { return repository.create(id,request); }
    @PostMapping("/{id}/observations") public SessionView observe(@PathVariable UUID id,@Valid @RequestBody Observation observation) { return repository.observe(id,observation); }
    @PostMapping("/{id}/end") public SessionView end(@PathVariable UUID id,@Valid @RequestBody EndSession request) { return repository.end(id,request); }
    @GetMapping("/{id}") public SessionView get(@PathVariable UUID id) { return repository.get(id); }
}
