package org.posegood.cep.web;

import jakarta.validation.Valid;

import org.posegood.cep.application.CepSessionService;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.RestoreSession;
import org.posegood.contracts.SessionView;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/internal/sessions")
public class CepController {
    private final CepSessionService sessions;

    public CepController(CepSessionService sessions) {
        this.sessions = sessions;
    }

    @PutMapping("/{id}")
    public SessionView create(@PathVariable UUID id, @Valid @RequestBody CreateSession request) {
        return sessions.create(id, request);
    }

    @PostMapping("/{id}/observations")
    public SessionView observe(@PathVariable UUID id, @Valid @RequestBody Observation observation) {
        return sessions.observe(id, observation);
    }

    @PostMapping("/{id}/end")
    public SessionView end(@PathVariable UUID id, @Valid @RequestBody EndSession request) {
        return sessions.end(id, request);
    }

    @GetMapping("/{id}")
    public SessionView get(@PathVariable UUID id) {
        return sessions.get(id);
    }

    @PostMapping("/{id}/restore")
    public SessionView restore(@PathVariable UUID id, @Valid @RequestBody RestoreSession request) {
        return sessions.restore(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        sessions.delete(id);
    }
}
