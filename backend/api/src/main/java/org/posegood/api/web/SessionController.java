package org.posegood.api.web;

import jakarta.validation.Valid;

import org.posegood.api.application.SessionOperations;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.FeatureResponse;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/v1/sessions")
public class SessionController {
    private final SessionOperations sessions;

    public SessionController(SessionOperations sessions) {
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

    @PostMapping("/{id}/features")
    public FeatureResponse features(
            @PathVariable UUID id, @Valid @RequestBody InferenceRequest request) {
        return sessions.features(id, request);
    }

    @PostMapping("/{id}/end")
    public SessionView end(@PathVariable UUID id, @Valid @RequestBody EndSession request) {
        return sessions.end(id, request);
    }

    @GetMapping("/{id}")
    public SessionView get(@PathVariable UUID id) {
        return sessions.get(id);
    }
}
