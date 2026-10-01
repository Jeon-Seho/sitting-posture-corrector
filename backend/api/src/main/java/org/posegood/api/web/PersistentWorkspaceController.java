package org.posegood.api.web;

import com.fasterxml.jackson.databind.JsonNode;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.account.UserStore;
import org.posegood.api.application.PersistentSessionService;
import org.posegood.api.persistence.JdbcWorkspaceStore;
import org.posegood.api.persistence.UserLocks;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

@RestController
@Profile("persistent")
public class PersistentWorkspaceController {
    private final CurrentUser current;
    private final UserStore users;
    private final UserLocks locks;
    private final JdbcWorkspaceStore workspace;
    private final PersistentSessionService sessions;

    public PersistentWorkspaceController(
            CurrentUser current,
            UserStore users,
            UserLocks locks,
            JdbcWorkspaceStore workspace,
            PersistentSessionService sessions) {
        this.current = current;
        this.users = users;
        this.locks = locks;
        this.workspace = workspace;
        this.sessions = sessions;
    }

    @GetMapping("/v1/workspace")
    public JsonNode workspace() {
        return workspace.get(current.id());
    }

    @PutMapping("/v1/workspace")
    public JsonNode update(@RequestBody JsonNode body) {
        return owned(() -> workspace.update(current.id(), body));
    }

    @GetMapping("/v1/records")
    public List<JsonNode> records() {
        return workspace.records(current.id());
    }

    @PostMapping("/v1/records")
    public JsonNode record(@RequestBody JsonNode body) {
        return owned(() -> workspace.save(current.id(), body));
    }

    @DeleteMapping("/v1/records/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRecord(@PathVariable String id) {
        owned(
                () -> {
                    workspace.deleteRecord(current.id(), id);
                    return null;
                });
    }

    @DeleteMapping("/v1/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSession(@PathVariable UUID id) {
        sessions.delete(id);
    }

    @GetMapping("/v1/sessions/{id}/metadata")
    public Object metadata(@PathVariable UUID id) {
        var value = sessions.metadata(id);
        return new Metadata(
                value.startedAt(), value.endedAt(), value.baseline(), value.modelVersion());
    }

    private <T> T owned(Supplier<T> work) {
        var id = current.id();
        return locks.withLock(
                id,
                () -> {
                    users.require(id);
                    return work.get();
                });
    }

    private record Metadata(
            java.time.Instant startedAt,
            java.time.Instant endedAt,
            UUID baselineId,
            String modelVersion) {}
}
