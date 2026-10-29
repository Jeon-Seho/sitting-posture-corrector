package org.posegood.api.session;

import jakarta.validation.Valid;

import org.posegood.api.account.CurrentUser;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * /v2/sessions/* 측정 HTTP 경로: 생성, 종료, 조회.
 *
 * 측정 입력은 {@code /v2/realtime}으로만 받는다. 특징 입력(S2)·메타데이터(S5)·세션 삭제(S6)는 2026-10-28 삭제했다
 * (기록 삭제는 R3, 계획 0062).
 *
 * 계약: contracts/accounts.v2.md, contracts/README.md.
 */
@RestController
@RequestMapping("/v2/sessions")
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
}
