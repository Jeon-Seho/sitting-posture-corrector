package com.posture.api.posture.cep.v1;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-22) v1 판정기 — 유효 시간 축 누적, 사건 5종, event_id, 요약, 중복·누락·제외 구간. */
class V1SessionJudgeTest {

    static final String SID = "00000000-0000-4000-8000-0000000000a1";
    static final V1Policy POLICY = new V1Policy(3000, 3000, 60000, 0.7);

    static V1Observation obs(long seq, long start, long end, String phase, boolean valid, double p) {
        return new V1Observation(seq, start, end, phase, valid, p, valid && p > 0 ? "unspecified" : "none");
    }

    /** seconds초 동안 0.5초 구간을 넣고, 나온 사건 종류를 모은다. */
    static long feed(V1SessionJudge j, long seq, long[] t, double seconds, String phase, boolean valid, double p,
                     List<Map<String, Object>> events, List<Map<String, Object>> progress) {
        for (int i = 0; i < seconds * 2; i++) {
            V1SessionJudge.Result r = j.accept(obs(seq++, t[0], t[0] + 500, phase, valid, p));
            assertThat(r.skipped()).isNull();
            for (Map<String, Object> d : r.decisions()) {
                events.add(event(d));
            }
            if (r.progress() != null) {
                progress.add(r.progress());
            }
            t[0] += 500;
        }
        return seq;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> event(Map<String, Object> decision) {
        return (Map<String, Object>) decision.get("event");
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> summary(Map<String, Object> body) {
        return (Map<String, Object>) body.get("summary");
    }

    static List<Object> kinds(List<Map<String, Object>> events) {
        List<Object> k = new ArrayList<>();
        for (Map<String, Object> e : events) {
            k.add(e.get("kind"));
        }
        return k;
    }

    /** T-10과 같은 시나리오: 정상 5s → 나쁜 자세 70s → 회복 10s → 종료. 서버 통합 테스트의 기대값 근거. */
    @Test
    void t10Scenario() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        List<Map<String, Object>> events = new ArrayList<>();
        List<Map<String, Object>> progress = new ArrayList<>();
        long[] t = {0};
        long seq = feed(j, 0, t, 5, "running", true, 0.23, events, progress);
        seq = feed(j, seq, t, 70, "running", true, 1.0, events, progress);
        feed(j, seq, t, 10, "running", true, 0.23, events, progress);
        V1SessionJudge.Result end = j.end(85000);
        for (Map<String, Object> d : end.decisions()) {
            events.add(event(d));
        }

        assertThat(kinds(events)).containsExactly("collapse_confirmed", "reminder", "recovery_confirmed", "session_ended");
        assertThat(events.get(0).get("event_id")).isEqualTo(1L);
        assertThat(events.get(0).get("timestamp_ms")).isEqualTo(8000L);    // 5.0s + 후보 3s
        assertThat(events.get(0).get("onset_ms")).isEqualTo(5000L);
        assertThat(events.get(0).get("onset_valid_ms")).isEqualTo(5000L);
        assertThat(events.get(0).get("reason")).isNull();
        assertThat(events.get(1).get("timestamp_ms")).isEqualTo(68000L);   // 첫 알림 + 60s
        assertThat(events.get(2).get("timestamp_ms")).isEqualTo(78000L);   // 정상 75.0s + 3s
        assertThat(events.get(2).get("onset_ms")).isEqualTo(5000L);         // 실제 지속 = 78.0 - 5.0 = 73.0s
        assertThat(events.get(3).get("event_id")).isEqualTo(4L);
        assertThat(events.get(3).get("reason")).isEqualTo("ended");

        Map<String, Object> s = summary(end.progress());
        assertThat(s.get("total_ms")).isEqualTo(85000L);
        assertThat(s.get("valid_ms")).isEqualTo(85000L);
        assertThat(s.get("normal_ms")).isEqualTo(15000L);
        assertThat(s.get("deviation_ms")).isEqualTo(70000L);
        assertThat(s.get("collapse_count")).isEqualTo(1L);
        assertThat(s.get("alert_count")).isEqualTo(2L);
        assertThat(s.get("interval_count")).isEqualTo(0L);
        assertThat(s.get("mean_interval_ms")).isNull();
        assertThat(s.get("mean_recovery_ms")).isEqualTo(70000.0);         // 첫 알림 8.0s → 복귀 78.0s
        assertThat(s.get("keep_rate")).isEqualTo(15000.0 / 85000);
        assertThat(s.get("events_per_hour")).isEqualTo(3_600_000.0 / 85000);
        assertThat(end.progress().get("last_sequence")).isEqualTo(169L);
        // progress는 약 1초(2구간)마다 — 85초 동안 85개
        assertThat(progress).hasSize(85);
    }

    @Test
    void decisionCarriesSummaryAfterTheEventAndLastSequence() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        V1SessionJudge.Result r = null;
        for (int i = 0; i < 6; i++) {
            r = j.accept(obs(i, i * 500L, i * 500L + 500, "running", true, 0.9));
        }
        assertThat(r.decisions()).hasSize(1);
        Map<String, Object> d = r.decisions().get(0);
        assertThat(d.get("last_sequence")).isEqualTo(5L);
        assertThat(summary(d).get("collapse_count")).isEqualTo(1L);
        assertThat(summary(d).get("alert_count")).isEqualTo(1L);
    }

    @Test
    void duplicateAndOldSequencesAreIgnored() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        assertThat(j.accept(obs(0, 0, 500, "running", true, 0.9)).skipped()).isNull();
        assertThat(j.accept(obs(0, 0, 500, "running", true, 0.9)).skipped()).isNotNull();   // 재전송
        assertThat(j.accept(obs(1, 500, 1000, "running", true, 0.9)).skipped()).isNull();
        assertThat(j.accept(obs(1, 500, 1000, "running", true, 0.9)).skipped()).isNotNull();
        // 중복이 섞여도 누적은 한 번만: 1000ms 후보 → 아직 확정 아님
        assertThat(summary(j.view()).get("deviation_ms")).isEqualTo(1000L);
        assertThat(j.view().get("duplicates_ignored")).isEqualTo(2L);
    }

    @Test
    void oppositeSegmentResetsAccumulation() {
        // FE 회신 ③: 확정 전 정상 1구간이면 붕괴 누적 0
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        long seq = 0;
        long t = 0;
        for (int i = 0; i < 5; i++, t += 500) {
            j.accept(obs(seq++, t, t + 500, "running", true, 0.9));          // 2.5s
        }
        j.accept(obs(seq++, t, t + 500, "running", true, 0.1));               // 정상 1구간
        t += 500;
        V1SessionJudge.Result r = null;
        for (int i = 0; i < 5; i++, t += 500) {
            r = j.accept(obs(seq++, t, t + 500, "running", true, 0.9));       // 다시 2.5s
        }
        assertThat(r.decisions()).isEmpty();
        r = j.accept(obs(seq, t, t + 500, "running", true, 0.9));             // 3.0s
        assertThat(kinds(List.of(event(r.decisions().get(0))))).containsExactly("collapse_confirmed");
        assertThat(event(r.decisions().get(0)).get("onset_ms")).isEqualTo(3000L);
    }

    @Test
    void excludedSegmentInterruptsActiveEpisode() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        long t = 0;
        long seq = 0;
        for (int i = 0; i < 6; i++, t += 500) {
            j.accept(obs(seq++, t, t + 500, "running", true, 0.9));
        }
        V1SessionJudge.Result r = j.accept(obs(seq++, t, t + 500, "running", false, 0.0));   // 판정 불가
        Map<String, Object> e = event(r.decisions().get(0));
        assertThat(e.get("kind")).isEqualTo("interrupted");
        assertThat(e.get("reason")).isEqualTo("unmeasurable");
        assertThat(e.get("timestamp_ms")).isEqualTo(3000L);
        t += 500;
        r = j.accept(obs(seq, t, t + 500, "away", false, 0.0));
        assertThat(r.decisions()).isEmpty();                                   // 이미 닫힘
        Map<String, Object> s = summary(j.view());
        assertThat(s.get("unknown_ms")).isEqualTo(500L);
        assertThat(s.get("away_ms")).isEqualTo(500L);
        assertThat(s.get("valid_ms")).isEqualTo(3000L);
    }

    @Test
    void gapsAreMissingAndInterrupt() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        long t = 0;
        for (int i = 0; i < 6; i++, t += 500) {
            j.accept(obs(i, t, t + 500, "running", true, 0.9));
        }
        // 시간 공백 1000ms
        V1SessionJudge.Result r = j.accept(obs(6, 4000, 4500, "running", true, 0.9));
        assertThat(event(r.decisions().get(0)).get("reason")).isEqualTo("missing");
        assertThat(summary(j.view()).get("missing_ms")).isEqualTo(1000L);
        // 순번 건너뜀(시간은 이어짐)
        j.accept(obs(7, 4500, 5000, "running", true, 0.9));
        j.accept(obs(8, 5000, 5500, "running", true, 0.9));
        j.accept(obs(9, 5500, 6000, "running", true, 0.9));
        j.accept(obs(10, 6000, 6500, "running", true, 0.9));
        r = j.accept(obs(11, 6500, 7000, "running", true, 0.9));
        assertThat(event(r.decisions().get(0)).get("kind")).isEqualTo("collapse_confirmed");   // 4.0~7.0s 3초
        r = j.accept(obs(13, 7000, 7500, "running", true, 0.9));
        assertThat(event(r.decisions().get(0)).get("reason")).isEqualTo("missing_sequence");
        // 겹치는 구간은 반영 안 함
        assertThat(j.accept(obs(14, 7000, 7500, "running", true, 0.9)).skipped()).isNotNull();
    }

    @Test
    void secondEpisodeCountsInterval() {
        V1SessionJudge j = new V1SessionJudge(SID, new V1Policy(1000, 1000, 60000, 0.7));
        long t = 0;
        long seq = 0;
        double[] pattern = {0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.1, 0.1};   // 0.5s 구간
        for (double p : pattern) {
            j.accept(obs(seq++, t, t + 500, "running", true, p));
            t += 500;
        }
        Map<String, Object> s = summary(j.view());
        assertThat(s.get("collapse_count")).isEqualTo(2L);
        assertThat(s.get("interval_count")).isEqualTo(1L);
        assertThat(s.get("mean_interval_ms")).isEqualTo(3000.0);             // 시작 0.0s → 3.0s(유효 시간 축)
        assertThat(s.get("mean_recovery_ms")).isEqualTo(1000.0);             // 알림 1.0s → 복귀 2.0s
    }

    @Test
    void endWhileActiveInterruptsThenEndsAndRejectsLaterInput() {
        V1SessionJudge j = new V1SessionJudge(SID, POLICY);
        long t = 0;
        for (int i = 0; i < 8; i++, t += 500) {
            j.accept(obs(i, t, t + 500, "running", true, 0.9));
        }
        V1SessionJudge.Result r = j.end(5000);
        // 공백(4.0~5.0s)에서 먼저 끊김(missing) — 그 뒤 ended 끊김은 닫을 사건이 없어 나오지 않음
        assertThat(kinds(List.of(event(r.decisions().get(0)), event(r.decisions().get(1)))))
                .containsExactly("interrupted", "session_ended");
        assertThat(r.decisions()).hasSize(2);
        assertThat(event(r.decisions().get(0)).get("reason")).isEqualTo("missing");
        assertThat(summary(r.progress()).get("missing_ms")).isEqualTo(1000L);
        assertThat(j.end(5000).skipped()).isNotNull();
        assertThat(j.accept(obs(8, 5000, 5500, "running", true, 0.9)).skipped()).isNotNull();
    }

    @Test
    void policyFromSessionStartedIsUsed() {
        V1Policy p = V1Policy.fromBody(Map.of("hold_ms", 1000, "recovery_ms", 2000, "reminder_ms", 30000,
                "threshold", 0.5), POLICY);
        assertThat(p).isEqualTo(new V1Policy(1000, 2000, 30000, 0.5));
        assertThat(V1Policy.fromBody(null, POLICY)).isEqualTo(POLICY);
        V1SessionJudge j = new V1SessionJudge(SID, p);
        j.accept(obs(0, 0, 500, "running", true, 0.55));
        V1SessionJudge.Result r = j.accept(obs(1, 500, 1000, "running", true, 0.55));
        assertThat(event(r.decisions().get(0)).get("kind")).isEqualTo("collapse_confirmed");
    }
}
