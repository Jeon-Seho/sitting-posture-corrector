package com.posture.api.posture.judge;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * v1 판정기(Kafka 계약 v1 {@code posture.inference.v1} → {@code posture.episodes.v1}) 조회 API.
 *
 * <p>(D-53) 판정은 상태머신이고 CEP 엔진을 쓰지 않아 옛 경로 {@code /cep/v1/*}를 {@code /judge/v1/*}로 바꿨다.
 * 운영·확인용이며 앱은 부르지 않는다(docs/design/processing-api-spec.md).
 */
@RestController
public class JudgeAdminController {

	private final V1JudgeRegistry registry;

	public JudgeAdminController(V1JudgeRegistry registry) {
		this.registry = registry;
	}

	/** (D-22) 진행 중 세션 수, 발행한 decision/progress 수, 건너뛴 관측 수, 재시작 뒤 복원한 세션 수. */
	@GetMapping("/judge/v1/status")
	public Map<String, Object> status() {
		return registry.status();
	}

	/** (D-22) 세션의 정책·요약·사건 목록(진행 중 또는 최근 종료 200개). 없으면 404. */
	@GetMapping("/judge/v1/sessions/{sessionId}")
	public ResponseEntity<Map<String, Object>> session(
		@PathVariable
		String sessionId) {
		return registry.view(sessionId)
			.map(ResponseEntity::ok)
			.orElseGet(() -> ResponseEntity.notFound().build());
	}
}
