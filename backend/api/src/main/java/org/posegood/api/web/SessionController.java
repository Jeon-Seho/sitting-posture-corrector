package org.posegood.api.web;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import org.posegood.api.application.SessionOperations;
import org.posegood.api.application.SessionSetup;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.FeatureResponse;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.posegood.contracts.Policy;
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
    public SessionView create(@PathVariable UUID id, @Valid @RequestBody CreateRequest request) {
        return sessions.create(id, new CreateSession(request.policy()), request.setup());
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

    /**
     * The shared CEP contract stays {@code {policy}}; only the public API adds {@code setup}.
     * Setter binding keeps {@code setup} optional under fail-on-missing-creator-properties.
     */
    public static final class CreateRequest {
        @NotNull @Valid private Policy policy;
        @Valid private SessionSetup setup;

        public Policy policy() {
            return policy;
        }

        public SessionSetup setup() {
            return setup;
        }

        public void setPolicy(Policy policy) {
            this.policy = policy;
        }

        public void setSetup(SessionSetup setup) {
            this.setup = setup;
        }
    }
}
