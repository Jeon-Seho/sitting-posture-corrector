package org.posegood.api.workspace;

import tools.jackson.databind.JsonNode;

import org.posegood.api.account.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * /v2/workspace·/v2/records HTTP 경로: 설정과 기록.
 *
 * 계약: contracts/accounts.v2.md.
 */
@RestController
@RequestMapping("/v2")
public class WorkspaceController {
    private final WorkspaceService workspace;
    private final CurrentUser current;

    public WorkspaceController(WorkspaceService workspace, CurrentUser current) {
        this.workspace = workspace;
        this.current = current;
    }

    /** 설정 + 기록 조회. */
    @GetMapping("/workspace")
    public JsonNode workspace() {
        return workspace.get(current.id());
    }

    /** 설정 저장. */
    @PutMapping("/workspace")
    public JsonNode update(@RequestBody JsonNode body) {
        return workspace.update(current.id(), body);
    }

    @PutMapping("/consents/optional-profile")
    public JsonNode optionalConsent(@jakarta.validation.Valid @RequestBody OptionalConsent body) {
        return workspace.optionalConsent(current.id(), body.agreed(), body.documentVersion());
    }

    public record OptionalConsent(boolean agreed, @jakarta.validation.constraints.NotBlank String documentVersion) {}

    /** 기록 목록. */
    @GetMapping("/records")
    public List<JsonNode> records() {
        return workspace.records(current.id());
    }

    /** 기록 저장. */
    @PostMapping("/records")
    public JsonNode save(@RequestBody JsonNode body) {
        return workspace.save(current.id(), body);
    }

    /** 기록(= 세션) 삭제. */
    @DeleteMapping("/records/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        workspace.deleteRecord(current.id(), id);
    }
}
