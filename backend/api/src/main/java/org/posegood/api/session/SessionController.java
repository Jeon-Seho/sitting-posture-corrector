package org.posegood.api.session;

import jakarta.validation.Valid;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * /v1/sessions/* 측정 HTTP 경로: 생성, 특징 입력, 종료, 조회, 메타데이터, 삭제.
 *
 * 계약: contracts/accounts.v1.md, contracts/README.md.
 */
@RestController
@RequestMapping("/v1/sessions")
public class SessionController {
    private final SessionService sessions;
    private final CurrentUser current;

    public SessionController(SessionService sessions, CurrentUser current) {
        this.sessions = sessions;
        this.current = current;
    }

    /** 세션 생성(PUT). 같은 요청을 다시 보내면 같은 결과. */
    @PutMapping("/{id}")
    public SessionView create(
            @PathVariable UUID id, @Valid @RequestBody SessionRequests.Create request) {
        return sessions.create(current.id(), id, request);
    }

    /** 특징 입력 → 추론 → 판정. */
    @PostMapping("/{id}/features")
    public SessionRequests.FeatureResponse features(
            @PathVariable UUID id, @Valid @RequestBody InferenceRequest request) {
        return sessions.features(current.id(), id, request);
    }

    /** 세션 종료. */
    @PostMapping("/{id}/end")
    public SessionView end(@PathVariable UUID id, @Valid @RequestBody SessionRequests.End request) {
        return sessions.end(current.id(), id, request.endMs());
    }

    /** 현재 상태 조회. */
    @GetMapping("/{id}")
    public SessionView get(@PathVariable UUID id) {
        return sessions.get(current.id(), id);
    }

    /** 시작·종료 시각, 기준 자세 ID, 모델 버전. */
    @GetMapping("/{id}/metadata")
    public SessionService.Metadata metadata(@PathVariable UUID id) {
        return sessions.metadata(current.id(), id);
    }

    /** 세션 삭제. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        sessions.delete(current.id(), id);
    }
}
