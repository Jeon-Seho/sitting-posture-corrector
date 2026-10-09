package com.posture.api.posture.cep;

import com.posture.api.posture.cep.v1.V1JudgeRegistry;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * posture-cep(Python)이 노출하던 {@code /cep/*} 조회·관리 API를 그대로
 * api-server로 옮긴 것(D-13). 응답 형태는 posture-cep과 동일하게
 * 유지해서, 기존에 이 엔드포인트를 참조하던 테스트 스크립트를 그대로
 * 쓸 수 있게 한다.
 */
@RestController
public class CepAdminController {

    private final PostureCepEngine engine;
    private final SessionExpiryScheduler sessionExpiryScheduler;
    private final CepWriteBuffer writeBuffer;
    private final V1JudgeRegistry v1Registry;

    public CepAdminController(PostureCepEngine engine, SessionExpiryScheduler sessionExpiryScheduler,
                              CepWriteBuffer writeBuffer, V1JudgeRegistry v1Registry) {
        this.engine = engine;
        this.sessionExpiryScheduler = sessionExpiryScheduler;
        this.writeBuffer = writeBuffer;
        this.v1Registry = v1Registry;
    }

    /** (D-22) v1 판정기 상태 — 진행 중 세션 수, 발행한 decision/progress 수, 건너뛴 관측 수. */
    @GetMapping("/cep/v1/status")
    public Map<String, Object> v1Status() {
        return v1Registry.status();
    }

    /** (D-22) v1 세션의 정책·요약·사건 목록(진행 중 또는 최근 종료 200개). 없으면 404. */
    @GetMapping("/cep/v1/sessions/{sessionId}")
    public ResponseEntity<Map<String, Object>> v1Session(@PathVariable String sessionId) {
        return v1Registry.view(sessionId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * (D-18) DB 쓰기 버퍼 상태 — 보관 중인 기록 수, 연속 실패 횟수, 마지막 성공 시각 등.
     * DB 장애 중에도 판정이 계속되는지, 복구 후 보관분이 반영됐는지 확인할 때 쓴다.
     */
    @GetMapping("/cep/db-writer")
    public Map<String, Object> dbWriterStatus() {
        return writeBuffer.status();
    }

    /** 현재 지속조건을 충족해 진행 중인(아직 회복되지 않은) 붕괴 이벤트 목록. */
    @GetMapping("/cep/active")
    public Map<String, Object> activeEvents() {
        List<Map<String, Object>> events = engine.activeEvents();
        return Map.of("count", events.size(), "events", events);
    }

    /** 최근 종료(회복)된 붕괴 이벤트 목록. */
    @GetMapping("/cep/events/recent")
    public Map<String, Object> recentEvents(@RequestParam(defaultValue = "20") int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        List<Map<String, Object>> events = engine.recentEvents(bounded);
        return Map.of("count", events.size(), "events", events);
    }

    /**
     * 세션 만료 검사를 즉시 한 번 수행한다 (D-10). 원래는
     * {@link SessionExpiryScheduler}가 주기적으로(기본 60초) 자동 실행하지만,
     * 타임아웃(기본 5분)을 기다리지 않고 바로 검증하고 싶을 때 이
     * 엔드포인트로 즉시 트리거할 수 있다.
     */
    @PostMapping("/cep/sessions/expire")
    public Map<String, Object> expireSessionsNow() {
        return sessionExpiryScheduler.runOnce();
    }
}
