package com.posture.api.posture.judge;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.ObjectMapper;

/**
 * T-15 판정 동등성: 공용 시험 데이터({@code contracts/realtime/parity/judge-cases.v1.json}, 기대값은 팀 API 판정
 * {@code engine/SessionEngine}으로 만듦)를 이 판정기에 넣으면 사건·요약·제외 구간이 같다(계획 0031, D-57).
 *
 * <p>제외 구간은 (D-39) {@code excluded_ended} 사건에서 읽는다. 사건 번호는 제외 구간 사건 때문에 다르므로 비교하지 않는다.
 * 관측마다 Redis 스냅샷으로 옮겼다가 되살려 재시작 복원(D-37)도 같은 결과인지 본다. 모든 관측은 합성이다.
 */
class V1SessionJudgeParityTest {
	static final Path CASES = Path.of("..", "..", "contracts", "realtime", "parity", "judge-cases.v1.json");
	static final List<String> EVENT_KEYS = List.of("kind", "timestamp_ms", "onset_ms", "onset_valid_ms",
		"deviation_type", "reason");
	static final List<String> SUMMARY_COUNTS = List.of("total_ms", "valid_ms", "normal_ms", "deviation_ms", "rest_ms",
		"away_ms", "unknown_ms", "missing_ms", "collapse_count", "alert_count", "interval_count");
	static final List<String> SUMMARY_RATIOS = List.of("keep_rate", "events_per_hour", "mean_interval_ms",
		"mean_recovery_ms");
	static final Map<String, String> DB_REASONS = Map.of("rest", "PAUSE", "away", "ABSENCE", "unmeasurable",
		"UNMEASURABLE", "missing", "MISSING");

	@Test
	@SuppressWarnings("unchecked")
	void sameEventsSummaryAndExclusionsAsTheApiEngine() {
		Map<String, Object> doc = new ObjectMapper().readValue(CASES.toFile(), Map.class);
		List<Map<String, Object>> cases = (List<Map<String, Object>>)doc.get("cases");
		assertEquals(6, cases.size());
		for (Map<String, Object> c : cases) {
			String name = (String)c.get("name");
			Map<String, Object> policyValues = (Map<String, Object>)c.get("policy");
			V1SessionJudge judge = new V1SessionJudge("00000000-0000-4000-8000-0000000000f5", new V1Policy(
				num(policyValues.get("hold_ms")), num(policyValues.get("recovery_ms")),
				num(policyValues.get("reminder_ms")),
				((Number)policyValues.get("threshold")).doubleValue()));
			List<Map<String, Object>> decisions = new ArrayList<>();
			for (List<Object> row : (List<List<Object>>)c.get("observations")) {
				V1SessionJudge.Result result = judge.accept(new V1Observation(num(row.get(0)), num(row.get(1)),
					num(row.get(2)), (String)row.get(3), (Boolean)row.get(4),
					((Number)row.get(5)).doubleValue(), (String)row.get(6)));
				assertEquals(null, result.skipped(), name);
				decisions.addAll(result.decisions());
				judge = V1SessionJudge.restore(judge.snapshot());
			}
			V1SessionJudge.Result last = judge.end(num(c.get("end_ms")));
			decisions.addAll(last.decisions());

			List<Map<String, Object>> events = new ArrayList<>();
			List<Map<String, Object>> spans = new ArrayList<>();
			for (Map<String, Object> d : decisions) {
				Map<String, Object> event = (Map<String, Object>)d.get("event");
				String kind = (String)event.get("kind");
				if ("excluded_ended".equals(kind)) {
					Map<String, Object> values = new LinkedHashMap<>();
					values.put("start_ms", event.get("onset_ms"));
					values.put("end_ms", event.get("timestamp_ms"));
					values.put("reason", DB_REASONS.get((String)event.get("reason")));
					spans.add(values);
				}
				if (kind.startsWith("excluded_")) {
					continue;
				}
				Map<String, Object> values = new LinkedHashMap<>();
				for (String k : EVENT_KEYS) {
					values.put(k, event.get(k));
				}
				events.add(values);
			}
			Map<String, Object> expected = (Map<String, Object>)c.get("expected");
			assertEquals(normalize((List<Map<String, Object>>)expected.get("events")), events, name + " events");
			assertEquals(normalize((List<Map<String, Object>>)expected.get("excluded")), spans, name + " excluded");

			Map<String, Object> summary = (Map<String, Object>)last.progress().get("summary");
			Map<String, Object> es = (Map<String, Object>)expected.get("summary");
			for (String k : SUMMARY_COUNTS) {
				assertEquals(num(es.get(k)), num(summary.get(k)), name + " " + k);
			}
			for (String k : SUMMARY_RATIOS) {
				if (es.get(k) == null) {
					assertEquals(null, summary.get(k), name + " " + k);
				} else {
					assertEquals(((Number)es.get(k)).doubleValue(), ((Number)summary.get(k)).doubleValue(), 1e-9,
						name + " " + k);
				}
			}
		}
	}

	static List<Map<String, Object>> normalize(List<Map<String, Object>> rows) {
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> r : rows) {
			Map<String, Object> values = new LinkedHashMap<>();
			for (Map.Entry<String, Object> e : r.entrySet()) {
				values.put(e.getKey(), e.getValue() instanceof Number n ? (Object)n.longValue() : e.getValue());
			}
			out.add(values);
		}
		return out;
	}

	static long num(Object value) {
		return ((Number)value).longValue();
	}
}
