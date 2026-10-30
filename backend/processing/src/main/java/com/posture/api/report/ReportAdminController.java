package com.posture.api.report;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * (D-30) 판정 결과 저장 확인용 API.
 * <ul>
 *   <li>{@code GET /report/store} — 저장 컨슈머 상태(받은 수·저장·중복·세션 없음·DLQ·DB 실패).</li>
 *   <li>{@code GET /report/sessions/{session_id}} — 저장된 세션·이벤트·알림(세션 시작 기준 ms).</li>
 *   <li>시험용({@code REPORT_TEST_FIXTURES_ENABLED=true}일 때만): {@code POST/DELETE /report/test/sessions/{session_id}}
 *       시험 계정·세션 행 만들기·지우기, {@code POST /report/test/apply} episodes 메시지를 다시 넣어 같은 결과인지(재전송 시험).</li>
 * </ul>
 */
@RestController
@RequestMapping("/report")
public class ReportAdminController {

	private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F-]{36}");

	private final EpisodesStoreConsumer consumer;
	private final EpisodeStore store;
	private final JdbcReportTestFixtures fixtures;
	private final boolean fixturesEnabled;

	public ReportAdminController(EpisodesStoreConsumer consumer, EpisodeStore store, JdbcReportTestFixtures fixtures,
		@Value("${report.test-fixtures.enabled:false}")
		boolean fixturesEnabled) {
		this.consumer = consumer;
		this.store = store;
		this.fixtures = fixtures;
		this.fixturesEnabled = fixturesEnabled;
	}

	@GetMapping("/store")
	public Map<String, Object> status() {
		Map<String, Object> status = new LinkedHashMap<>(consumer.status());
		status.put("testFixturesEnabled", fixturesEnabled);
		return status;
	}

	@GetMapping("/sessions/{sessionId}")
	public ResponseEntity<Map<String, Object>> session(
		@PathVariable("sessionId")
		String sessionId) {
		if (!UUID_TEXT.matcher(sessionId).matches()) {
			return ResponseEntity.badRequest().body(Map.of("error", "session_id는 UUID"));
		}
		return store.sessionView(sessionId)
			.map(ResponseEntity::ok)
			.orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "세션 행 없음")));
	}

	@PostMapping("/test/sessions/{sessionId}")
	public ResponseEntity<Map<String, Object>> createTestSession(
		@PathVariable("sessionId")
		String sessionId,
		@RequestParam(name = "alertEnabled", defaultValue = "true")
		boolean alertEnabled,
		@RequestParam(name = "startedAt", required = false)
		String startedAt) {
		if (!fixturesEnabled) {
			return forbidden();
		}
		if (!UUID_TEXT.matcher(sessionId).matches()) {
			return ResponseEntity.badRequest().body(Map.of("error", "session_id는 UUID"));
		}
		Instant start = startedAt == null || startedAt.isBlank() ? Instant.now() : Instant.parse(startedAt);
		return ResponseEntity.ok(fixtures.createSession(sessionId, alertEnabled, start));
	}

	@DeleteMapping("/test/sessions/{sessionId}")
	public ResponseEntity<Map<String, Object>> deleteTestSession(
		@PathVariable("sessionId")
		String sessionId) {
		if (!fixturesEnabled) {
			return forbidden();
		}
		return ResponseEntity.ok(Map.of("deletedSessions", fixtures.deleteSession(sessionId)));
	}

	/** 본문: JSON Lines(episodes 메시지 한 줄에 하나). 컨슈머와 같은 처리를 순서대로 한다. */
	@PostMapping("/test/apply")
	public ResponseEntity<Map<String, Object>> apply(
		@RequestBody
		String jsonLines) {
		if (!fixturesEnabled) {
			return forbidden();
		}
		int applied = 0;
		List<String> errors = new ArrayList<>();
		for (String line : jsonLines.split("\n")) {
			if (line.isBlank()) {
				continue;
			}
			String err = consumer.handle(line.trim());
			if (err != null) {
				errors.add(err);
			} else {
				applied++;
			}
		}
		Map<String, Object> result = new LinkedHashMap<>();
		result.put("applied", applied);
		result.put("errors", errors);
		result.put("store", consumer.status());
		return ResponseEntity.ok(result);
	}

	private static ResponseEntity<Map<String, Object>> forbidden() {
		return ResponseEntity.status(HttpStatus.FORBIDDEN)
			.body(Map.of("error", "시험용 API 꺼짐 (REPORT_TEST_FIXTURES_ENABLED=true로 켜기)"));
	}
}
