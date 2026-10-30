package com.posture.api.posture.judge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** (D-22) v1 판정기 — 유효 시간 축 누적, 사건 5종, event_id, 요약, 중복·누락·제외 구간. */
class V1SessionJudgeTest {

	static final String SID = "00000000-0000-4000-8000-0000000000a1";
	static final V1Policy POLICY = new V1Policy(3000, 3000, 60000, 0.7);

	static V1Observation obs(long seq, long start, long end, String phase, boolean valid, double collapseProbability) {
		return new V1Observation(seq, start, end, phase, valid, collapseProbability,
			valid && collapseProbability > 0 ? "unspecified" : "none");
	}

	/** seconds초 동안 0.5초 구간을 넣고, 나온 사건 종류를 모은다. */
	static long feed(V1SessionJudge judge, long seq, long[] timeMs, double seconds, String phase, boolean valid,
		double collapseProbability,
		List<Map<String, Object>> events, List<Map<String, Object>> progress) {
		for (int i = 0; i < seconds * 2; i++) {
			V1SessionJudge.Result result = judge.accept(
				obs(seq++, timeMs[0], timeMs[0] + 500, phase, valid, collapseProbability));
			assertThat(result.skipped()).isNull();
			for (Map<String, Object> d : result.decisions()) {
				events.add(event(d));
			}
			if (result.progress() != null) {
				progress.add(result.progress());
			}
			timeMs[0] += 500;
		}
		return seq;
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> event(Map<String, Object> decision) {
		return (Map<String, Object>)decision.get("event");
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> summary(Map<String, Object> body) {
		return (Map<String, Object>)body.get("summary");
	}

	static List<Object> kinds(List<Map<String, Object>> events) {
		List<Object> key = new ArrayList<>();
		for (Map<String, Object> e : events) {
			key.add(e.get("kind"));
		}
		return key;
	}

	/** T-10과 같은 시나리오: 정상 5s → 나쁜 자세 70s → 회복 10s → 종료. 서버 통합 테스트의 기대값 근거. */
	@Test
	void t10Scenario() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		List<Map<String, Object>> events = new ArrayList<>();
		List<Map<String, Object>> progress = new ArrayList<>();
		long[] timeMs = {0};
		long seq = feed(judge, 0, timeMs, 5, "running", true, 0.23, events, progress);
		seq = feed(judge, seq, timeMs, 70, "running", true, 1.0, events, progress);
		feed(judge, seq, timeMs, 10, "running", true, 0.23, events, progress);
		V1SessionJudge.Result end = judge.end(85000);
		for (Map<String, Object> d : end.decisions()) {
			events.add(event(d));
		}

		assertThat(kinds(events)).containsExactly("collapse_confirmed", "reminder", "recovery_confirmed",
			"session_ended");
		assertThat(events.get(0).get("event_id")).isEqualTo(1L);
		assertThat(events.get(0).get("timestamp_ms")).isEqualTo(8000L); // 5.0s + 후보 3s
		assertThat(events.get(0).get("onset_ms")).isEqualTo(5000L);
		assertThat(events.get(0).get("onset_valid_ms")).isEqualTo(5000L);
		assertThat(events.get(0).get("reason")).isNull();
		assertThat(events.get(1).get("timestamp_ms")).isEqualTo(68000L); // 첫 알림 + 60s
		assertThat(events.get(2).get("timestamp_ms")).isEqualTo(78000L); // 정상 75.0s + 3s
		assertThat(events.get(2).get("onset_ms")).isEqualTo(5000L); // 실제 지속 = 78.0 - 5.0 = 73.0s
		assertThat(events.get(3).get("event_id")).isEqualTo(4L);
		assertThat(events.get(3).get("reason")).isEqualTo("ended");

		Map<String, Object> summary = summary(end.progress());
		assertThat(summary.get("total_ms")).isEqualTo(85000L);
		assertThat(summary.get("valid_ms")).isEqualTo(85000L);
		assertThat(summary.get("normal_ms")).isEqualTo(15000L);
		assertThat(summary.get("deviation_ms")).isEqualTo(70000L);
		assertThat(summary.get("collapse_count")).isEqualTo(1L);
		assertThat(summary.get("alert_count")).isEqualTo(2L);
		assertThat(summary.get("interval_count")).isEqualTo(0L);
		assertThat(summary.get("mean_interval_ms")).isNull();
		assertThat(summary.get("mean_recovery_ms")).isEqualTo(70000.0); // 첫 알림 8.0s → 복귀 78.0s
		assertThat(summary.get("keep_rate")).isEqualTo(15000.0 / 85000);
		assertThat(summary.get("events_per_hour")).isEqualTo(3_600_000.0 / 85000);
		assertThat(end.progress().get("last_sequence")).isEqualTo(169L);
		// progress는 약 1초(2구간)마다 — 85초 동안 85개
		assertThat(progress).hasSize(85);
	}

	@Test
	void decisionCarriesSummaryAfterTheEventAndLastSequence() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		V1SessionJudge.Result result = null;
		for (int i = 0; i < 6; i++) {
			result = judge.accept(obs(i, i * 500L, i * 500L + 500, "running", true, 0.9));
		}
		assertThat(result.decisions()).hasSize(1);
		Map<String, Object> decision = result.decisions().get(0);
		assertThat(decision.get("last_sequence")).isEqualTo(5L);
		assertThat(summary(decision).get("collapse_count")).isEqualTo(1L);
		assertThat(summary(decision).get("alert_count")).isEqualTo(1L);
	}

	@Test
	void duplicateAndOldSequencesAreIgnored() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		assertThat(judge.accept(obs(0, 0, 500, "running", true, 0.9)).skipped()).isNull();
		assertThat(judge.accept(obs(0, 0, 500, "running", true, 0.9)).skipped()).isNotNull(); // 재전송
		assertThat(judge.accept(obs(1, 500, 1000, "running", true, 0.9)).skipped()).isNull();
		assertThat(judge.accept(obs(1, 500, 1000, "running", true, 0.9)).skipped()).isNotNull();
		// 중복이 섞여도 누적은 한 번만: 1000ms 후보 → 아직 확정 아님
		assertThat(summary(judge.view()).get("deviation_ms")).isEqualTo(1000L);
		assertThat(judge.view().get("duplicates_ignored")).isEqualTo(2L);
	}

	@Test
	void oppositeSegmentResetsAccumulation() {
		// FE 회신 ③: 확정 전 정상 1구간이면 붕괴 누적 0
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		long seq = 0;
		long timeMs = 0;
		for (int i = 0; i < 5; i++, timeMs += 500) {
			judge.accept(obs(seq++, timeMs, timeMs + 500, "running", true, 0.9)); // 2.5s
		}
		judge.accept(obs(seq++, timeMs, timeMs + 500, "running", true, 0.1)); // 정상 1구간
		timeMs += 500;
		V1SessionJudge.Result result = null;
		for (int i = 0; i < 5; i++, timeMs += 500) {
			result = judge.accept(obs(seq++, timeMs, timeMs + 500, "running", true, 0.9)); // 다시 2.5s
		}
		assertThat(result.decisions()).isEmpty();
		result = judge.accept(obs(seq, timeMs, timeMs + 500, "running", true, 0.9)); // 3.0s
		assertThat(kinds(List.of(event(result.decisions().get(0))))).containsExactly("collapse_confirmed");
		assertThat(event(result.decisions().get(0)).get("onset_ms")).isEqualTo(3000L);
	}

	@Test
	void excludedSegmentInterruptsActiveEpisode() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		long timeMs = 0;
		long seq = 0;
		for (int i = 0; i < 6; i++, timeMs += 500) {
			judge.accept(obs(seq++, timeMs, timeMs + 500, "running", true, 0.9));
		}
		V1SessionJudge.Result result = judge.accept(obs(seq++, timeMs, timeMs + 500, "running", false, 0.0)); // 판정 불가
		Map<String, Object> event = event(result.decisions().get(0));
		assertThat(event.get("kind")).isEqualTo("interrupted");
		assertThat(event.get("reason")).isEqualTo("unmeasurable");
		assertThat(event.get("timestamp_ms")).isEqualTo(3000L);
		timeMs += 500;
		result = judge.accept(obs(seq, timeMs, timeMs + 500, "away", false, 0.0));
		// 사건은 이미 닫힘 — (D-39) 제외 구간 사유만 바뀜(판정 불가 3.0~3.5s 끝, 자리 비움 시작)
		assertThat(kinds(events(result))).containsExactly("excluded_ended", "excluded_started");
		Map<String, Object> summary = summary(judge.view());
		assertThat(summary.get("unknown_ms")).isEqualTo(500L);
		assertThat(summary.get("away_ms")).isEqualTo(500L);
		assertThat(summary.get("valid_ms")).isEqualTo(3000L);
	}

	@Test
	void gapsAreMissingAndInterrupt() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		long timeMs = 0;
		for (int i = 0; i < 6; i++, timeMs += 500) {
			judge.accept(obs(i, timeMs, timeMs + 500, "running", true, 0.9));
		}
		// 시간 공백 1000ms
		V1SessionJudge.Result result = judge.accept(obs(6, 4000, 4500, "running", true, 0.9));
		assertThat(event(result.decisions().get(0)).get("reason")).isEqualTo("missing");
		assertThat(summary(judge.view()).get("missing_ms")).isEqualTo(1000L);
		// 순번 건너뜀(시간은 이어짐)
		judge.accept(obs(7, 4500, 5000, "running", true, 0.9));
		judge.accept(obs(8, 5000, 5500, "running", true, 0.9));
		judge.accept(obs(9, 5500, 6000, "running", true, 0.9));
		judge.accept(obs(10, 6000, 6500, "running", true, 0.9));
		result = judge.accept(obs(11, 6500, 7000, "running", true, 0.9));
		assertThat(event(result.decisions().get(0)).get("kind")).isEqualTo("collapse_confirmed"); // 4.0~7.0s 3초
		result = judge.accept(obs(13, 7000, 7500, "running", true, 0.9));
		assertThat(event(result.decisions().get(0)).get("reason")).isEqualTo("missing_sequence");
		// 겹치는 구간은 반영 안 함
		assertThat(judge.accept(obs(14, 7000, 7500, "running", true, 0.9)).skipped()).isNotNull();
	}

	@Test
	void secondEpisodeCountsInterval() {
		V1SessionJudge judge = new V1SessionJudge(SID, new V1Policy(1000, 1000, 60000, 0.7));
		long timeMs = 0;
		long seq = 0;
		double[] pattern = {0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.1, 0.1}; // 0.5s 구간
		for (double p : pattern) {
			judge.accept(obs(seq++, timeMs, timeMs + 500, "running", true, p));
			timeMs += 500;
		}
		Map<String, Object> summary = summary(judge.view());
		assertThat(summary.get("collapse_count")).isEqualTo(2L);
		assertThat(summary.get("interval_count")).isEqualTo(1L);
		assertThat(summary.get("mean_interval_ms")).isEqualTo(3000.0); // 시작 0.0s → 3.0s(유효 시간 축)
		assertThat(summary.get("mean_recovery_ms")).isEqualTo(1000.0); // 알림 1.0s → 복귀 2.0s
	}

	@Test
	void endWhileActiveInterruptsThenEndsAndRejectsLaterInput() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		long timeMs = 0;
		for (int i = 0; i < 8; i++, timeMs += 500) {
			judge.accept(obs(i, timeMs, timeMs + 500, "running", true, 0.9));
		}
		V1SessionJudge.Result result = judge.end(5000);
		// 공백(4.0~5.0s)에서 먼저 끊김(missing) — 그 뒤 ended 끊김은 닫을 사건이 없어 나오지 않음.
		// (D-39) 공백은 누락 제외 구간으로 열렸다가 세션 종료 때 닫힌다.
		assertThat(kinds(events(result)))
			.containsExactly("interrupted", "excluded_started", "excluded_ended", "session_ended");
		assertThat(event(result.decisions().get(0)).get("reason")).isEqualTo("missing");
		assertThat(summary(result.progress()).get("missing_ms")).isEqualTo(1000L);
		assertThat(judge.end(5000).skipped()).isNotNull();
		assertThat(judge.accept(obs(8, 5000, 5500, "running", true, 0.9)).skipped()).isNotNull();
	}

	static List<Map<String, Object>> events(V1SessionJudge.Result result) {
		List<Map<String, Object>> events = new ArrayList<>();
		for (Map<String, Object> d : result.decisions()) {
			events.add(event(d));
		}
		return events;
	}

	/** (D-39) 제외 구간 경계: 같은 사유가 이어지면 한 구간, 사유가 바뀌거나 측정 구간이 오면 끝, 누락은 그 공백. */
	@Test
	void excludedIntervalsAreEmittedAtBoundaries() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		List<Map<String, Object>> ev = new ArrayList<>();
		ev.addAll(events(judge.accept(obs(0, 0, 500, "running", true, 0.1))));
		ev.addAll(events(judge.accept(obs(1, 500, 1000, "rest", false, 0.0))));
		ev.addAll(events(judge.accept(obs(2, 1000, 1500, "rest", false, 0.0)))); // 같은 사유 — 늘리기만
		ev.addAll(events(judge.accept(obs(4, 1500, 2000, "rest", false, 0.0)))); // 순번만 건너뜀 — 시간이 이어져 같은 구간
		ev.addAll(events(judge.accept(obs(5, 2000, 2500, "away", false, 0.0)))); // 사유 바뀜
		ev.addAll(events(judge.accept(obs(6, 3500, 4000, "running", true, 0.1)))); // 공백 2.5~3.5s 누락
		ev.addAll(events(judge.accept(obs(7, 4000, 4500, "running", false, 0.0)))); // 판정 불가
		ev.addAll(events(judge.end(4500)));
		List<String> spans = new ArrayList<>();
		for (Map<String, Object> e : ev) {
			if ("excluded_ended".equals(e.get("kind"))) {
				spans.add(e.get("onset_ms") + "-" + e.get("timestamp_ms") + ":" + e.get("reason"));
			}
			if (String.valueOf(e.get("kind")).startsWith("excluded_")) {
				assertThat(e.get("deviation_type")).isEqualTo("none");
			}
		}
		assertThat(spans).containsExactly("500-2000:rest", "2000-2500:away", "2500-3500:missing",
			"4000-4500:unmeasurable");
		assertThat(kinds(ev)).containsExactly(
			"excluded_started", "excluded_ended", "excluded_started", "excluded_ended", "excluded_started",
			"excluded_ended", "excluded_started", "excluded_ended", "session_ended");
		// event_id는 모든 사건을 통틀어 1부터 차례로
		assertThat(ev.get(ev.size() - 1).get("event_id")).isEqualTo(9L);
	}

	/** (D-39) 열린 제외 구간은 Redis 스냅샷으로 이어지고, D-39 전 스냅샷(키 없음)도 복원된다. */
	@Test
	void openExcludedIntervalSurvivesRestore() {
		V1SessionJudge judge = new V1SessionJudge(SID, POLICY);
		judge.accept(obs(0, 0, 500, "rest", false, 0.0));
		V1SessionJudge restored = V1SessionJudge.restore(judge.snapshot());
		List<Map<String, Object>> ev = events(restored.accept(obs(1, 500, 1000, "rest", false, 0.0)));
		assertThat(ev).isEmpty(); // 같은 구간을 늘리기만
		ev = events(restored.accept(obs(2, 1000, 1500, "running", true, 0.1)));
		assertThat(kinds(ev)).containsExactly("excluded_ended");
		assertThat(ev.get(0).get("onset_ms")).isEqualTo(0L);
		assertThat(ev.get(0).get("timestamp_ms")).isEqualTo(1000L);

		Map<String, Object> old = judge.snapshot();
		old.remove("excluded");
		V1SessionJudge legacy = V1SessionJudge.restore(old);
		assertThat(kinds(events(legacy.accept(obs(1, 500, 1000, "running", true, 0.1))))).isEmpty();
	}

	@Test
	void policyFromSessionStartedIsUsed() {
		V1Policy policy = V1Policy.fromBody(Map.of("hold_ms", 1000, "recovery_ms", 2000, "reminder_ms", 30000,
			"threshold", 0.5), POLICY);
		assertThat(policy).isEqualTo(new V1Policy(1000, 2000, 30000, 0.5));
		assertThat(V1Policy.fromBody(null, POLICY)).isEqualTo(POLICY);
		V1SessionJudge judge = new V1SessionJudge(SID, policy);
		judge.accept(obs(0, 0, 500, "running", true, 0.55));
		V1SessionJudge.Result result = judge.accept(obs(1, 500, 1000, "running", true, 0.55));
		assertThat(event(result.decisions().get(0)).get("kind")).isEqualTo("collapse_confirmed");
	}
}
