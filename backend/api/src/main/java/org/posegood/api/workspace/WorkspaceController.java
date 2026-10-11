package org.posegood.api.workspace;

import com.fasterxml.jackson.databind.JsonNode;

import org.posegood.api.account.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Settings and app records of contracts/accounts.v1.md. */
@RestController
@RequestMapping("/v1")
public class WorkspaceController {
    private final WorkspaceService workspace;
    private final CurrentUser current;

    public WorkspaceController(WorkspaceService workspace, CurrentUser current) {
        this.workspace = workspace;
        this.current = current;
    }

    @GetMapping("/workspace")
    public JsonNode workspace() {
        return workspace.get(current.id());
    }

    @PutMapping("/workspace")
    public JsonNode update(@RequestBody JsonNode body) {
        return workspace.update(current.id(), body);
    }

    @GetMapping("/records")
    public List<JsonNode> records() {
        return workspace.records(current.id());
    }

    @PostMapping("/records")
    public JsonNode save(@RequestBody JsonNode body) {
        return workspace.save(current.id(), body);
    }

    @DeleteMapping("/records/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        workspace.deleteRecord(current.id(), id);
    }
}
