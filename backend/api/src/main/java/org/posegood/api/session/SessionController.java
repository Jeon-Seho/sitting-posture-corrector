package org.posegood.api.session;

import jakarta.validation.Valid;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** {@code /v1/sessions} of contracts/accounts.v1.md and contracts/README.md. */
@RestController
@RequestMapping("/v1/sessions")
public class SessionController {
    private final SessionService sessions;
    private final CurrentUser current;

    public SessionController(SessionService sessions, CurrentUser current) {
        this.sessions = sessions;
        this.current = current;
    }

    @PutMapping("/{id}")
    public SessionView create(
            @PathVariable UUID id, @Valid @RequestBody SessionRequests.Create request) {
        return sessions.create(current.id(), id, request);
    }

    @PostMapping("/{id}/features")
    public SessionRequests.FeatureResponse features(
            @PathVariable UUID id, @Valid @RequestBody InferenceRequest request) {
        return sessions.features(current.id(), id, request);
    }

    @PostMapping("/{id}/end")
    public SessionView end(@PathVariable UUID id, @Valid @RequestBody SessionRequests.End request) {
        return sessions.end(current.id(), id, request.endMs());
    }

    @GetMapping("/{id}")
    public SessionView get(@PathVariable UUID id) {
        return sessions.get(current.id(), id);
    }

    @GetMapping("/{id}/metadata")
    public SessionService.Metadata metadata(@PathVariable UUID id) {
        return sessions.metadata(current.id(), id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        sessions.delete(current.id(), id);
    }
}
