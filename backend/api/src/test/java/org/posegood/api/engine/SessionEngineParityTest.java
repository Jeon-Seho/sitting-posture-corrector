package org.posegood.api.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;

import tools.jackson.databind.ObjectMapper;

/**
 * T-15 판정 동등성: 공용 시험 데이터({@code contracts/realtime/parity/judge-cases.v1.json})를 이 판정 엔진에 넣으면
 * 사건·요약·제외 구간이 기대값과 같다. 처리 서비스 판정({@code backend/processing} {@code V1SessionJudgeParityTest})도 같은
 * 데이터로 같은 기대값을 확인한다 — 두 판정이 같은 결과를 낸다는 근거(계획 0031, D-57). 모든 관측은 합성이다.
 */
class SessionEngineParityTest {
	static final Path CASES = Path.of("..", "..", "contracts", "realtime", "parity", "judge-cases.v1.json");

	@Test
	@SuppressWarnings("unchecked")
	void sameEventsSummaryAndExclusionsAsTheSharedCases() {
		Map<String, Object> doc = new ObjectMapper().readValue(CASES.toFile(), Map.class);
		var cases = (List<Map<String, Object>>)doc.get("cases");
		assertEquals(6, cases.size());
		for (var c : cases) {
			String name = (String)c.get("name");
			var policyValues = (Map<String, Object>)c.get("policy");
			var engine = new SessionEngine(UUID.randomUUID(), new Policy(
				num(policyValues.get("hold_ms")), num(policyValues.get("recovery_ms")),
				num(policyValues.get("reminder_ms")),
				((Number)policyValues.get("threshold")).doubleValue()));
			for (var row : (List<List<Object>>)c.get("observations")) {
				engine.accept(new Observation("2.0", num(row.get(0)), num(row.get(1)), num(row.get(2)),
					Observation.Phase.valueOf((String)row.get(3)), (Boolean)row.get(4),
					((Number)row.get(5)).doubleValue(), Observation.DeviationType.valueOf((String)row.get(6)),
					"reference-feature-rule-v1"));
			}
			var view = engine.end(num(c.get("end_ms")));
			var expected = (Map<String, Object>)c.get("expected");

			List<Map<String, Object>> events = new ArrayList<>();
			for (var e : view.events()) {
				Map<String, Object> values = new LinkedHashMap<>();
				values.put("kind", e.kind());
				values.put("timestamp_ms", e.timestampMs());
				values.put("onset_ms", e.onsetMs());
				values.put("onset_valid_ms", e.onsetValidMs());
				values.put("deviation_type", e.deviationType());
				values.put("reason", e.reason());
				events.add(values);
			}
			assertEquals(normalize((List<Map<String, Object>>)expected.get("events")), events, name + " events");

			List<Map<String, Object>> spans = new ArrayList<>();
			for (var x : engine.excluded()) {
				Map<String, Object> values = new LinkedHashMap<>();
				values.put("start_ms", x.startMs());
				values.put("end_ms", x.endMs());
				values.put("reason", x.reason().name());
				spans.add(values);
			}
			assertEquals(normalize((List<Map<String, Object>>)expected.get("excluded")), spans, name + " excluded");

			var summary = view.summary();
			var es = (Map<String, Object>)expected.get("summary");
			assertEquals(num(es.get("total_ms")), summary.totalMs(), name);
			assertEquals(num(es.get("valid_ms")), summary.validMs(), name);
			assertEquals(num(es.get("normal_ms")), summary.normalMs(), name);
			assertEquals(num(es.get("deviation_ms")), summary.deviationMs(), name);
			assertEquals(num(es.get("rest_ms")), summary.restMs(), name);
			assertEquals(num(es.get("away_ms")), summary.awayMs(), name);
			assertEquals(num(es.get("unknown_ms")), summary.unknownMs(), name);
			assertEquals(num(es.get("missing_ms")), summary.missingMs(), name);
			assertEquals(num(es.get("collapse_count")), summary.collapseCount(), name);
			assertEquals(num(es.get("alert_count")), summary.alertCount(), name);
			assertEquals(num(es.get("interval_count")), summary.intervalCount(), name);
			ratio(es.get("keep_rate"), summary.keepRate(), name);
			ratio(es.get("events_per_hour"), summary.eventsPerHour(), name);
			ratio(es.get("mean_interval_ms"), summary.meanIntervalMs(), name);
			ratio(es.get("mean_recovery_ms"), summary.meanRecoveryMs(), name);
		}
	}

	/** JSON 숫자(Integer·Long)를 Long으로 맞춘다. */
	static List<Map<String, Object>> normalize(List<Map<String, Object>> rows) {
		List<Map<String, Object>> out = new ArrayList<>();
		for (var r : rows) {
			Map<String, Object> values = new LinkedHashMap<>();
			for (var e : r.entrySet()) {
				values.put(e.getKey(), e.getValue() instanceof Number n ? (Object)n.longValue() : e.getValue());
			}
			out.add(values);
		}
		return out;
	}

	static long num(Object value) {
		return ((Number)value).longValue();
	}

	static void ratio(Object expected, Double actual, String name) {
		if (expected == null) {
			assertEquals(null, actual, name);
		} else {
			assertEquals(((Number)expected).doubleValue(), actual, 1e-9, name);
		}
	}
}
