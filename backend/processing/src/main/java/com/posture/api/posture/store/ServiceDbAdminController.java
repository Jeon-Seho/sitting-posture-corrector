package com.posture.api.posture.store;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** (D-32, D-51, D-65) 확정 서비스 DB(V2.6) 준비 상태 — 테이블·컬럼·기본 정책·권한. 부를 때마다 다시 검사한다. (D-53) 옛 경로 /cep/service-db */
@RestController
public class ServiceDbAdminController {

	private final ServiceSchemaVerifier verifier;

	public ServiceDbAdminController(ServiceSchemaVerifier verifier) {
		this.verifier = verifier;
	}

	@GetMapping("/store/service-db")
	public Map<String, Object> serviceDb() {
		return verifier.check();
	}
}
