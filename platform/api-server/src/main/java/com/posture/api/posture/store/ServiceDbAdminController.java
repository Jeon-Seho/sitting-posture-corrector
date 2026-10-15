package com.posture.api.posture.store;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** (D-32) 확정 서비스 DB(V2.1) 준비 상태 — 테이블·컬럼·기본 정책·권한. 부를 때마다 다시 검사한다. */
@RestController
public class ServiceDbAdminController {

    private final ServiceSchemaVerifier verifier;

    public ServiceDbAdminController(ServiceSchemaVerifier verifier) {
        this.verifier = verifier;
    }

    @GetMapping("/cep/service-db")
    public Map<String, Object> serviceDb() {
        return verifier.check();
    }
}
