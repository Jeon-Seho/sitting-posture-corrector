package com.posture.api.posture.cep;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-21) posture.inference.v1 → 판정 엔진 입력 변환과, 0.5초 구간 T-10 시나리오 판정. */
class RealtimeObservationMapperTest {

    static final String SID = "00000000-0000-4000-8000-0000000000a1";
    static final Instant T0 = Instant.parse("2026-10-06T06:00:00.000Z");

    static Map<String, Object> msg(String kind, Instant producedAt, Map<String, Object> body) {
        Map<String, Object> m = new HashMap<>();
        m.put("schema_version", "1.0");
        m.put("message_id", "00000000-0000-4000-8000-000000000003");
        m.put("session_id", SID);
        m.put("user_id", "synthetic-user-1");
        m.put("produced_at", producedAt.toString());
        m.put("kind", kind);
        m.put("body", body);
        return m;
    }

    static Map<String, Object> obs(long seq, long startMs, long endMs, String phase, boolean valid, double score) {
        Map<String, Object> b = new HashMap<>();
        b.put("schema_version", "2.0");
        b.put("sequence", seq);
        b.put("start_ms", startMs);
        b.put("end_ms", endMs);
        b.put("phase", phase);
        b.put("valid", valid);
        b.put("collapse_probability", score);
        b.put("deviation_type", valid && score > 0 ? "unspecified" : "none");
        b.put("model_version", "reference-feature-rule-v1");
        return b;
    }

    @Test
    void observationTimeIsSessionStartPlusEndMs() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 100);
        assertThat(mapper.map(msg("session_started", T0, new HashMap<>())).kind())
                .isEqualTo(RealtimeObservationMapper.Kind.SESSION_STARTED);
        // produced_at(추론 처리 시각)이 늦어도 판정 시각은 시작 + end_ms
        RealtimeObservationMapper.Result r =
                mapper.map(msg("observation", T0.plusSeconds(9), obs(0, 0, 1000, "running", true, 0.9)));
        assertThat(r.event().get().capturedAt()).isEqualTo(T0.plusMillis(1000).toString());
        assertThat(r.event().get().inferredStatus()).isEqualTo("BAD");
        assertThat(r.event().get().userId()).isEqualTo("synthetic-user-1");
    }

    @Test
    void statusMapping() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 100);
        assertThat(mapper.status(obs(0, 0, 500, "running", true, 0.7))).isEqualTo("BAD");
        assertThat(mapper.status(obs(0, 0, 500, "running", true, 0.69))).isEqualTo("NORMAL");
        assertThat(mapper.status(obs(0, 0, 500, "running", false, 0.0))).isEqualTo("UNKNOWN");
        assertThat(mapper.status(obs(0, 0, 500, "rest", false, 0.0))).isEqualTo("UNKNOWN");
    }

    @Test
    void missingSessionStartFallsBackToProducedAtMinusEndMs() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 100);
        RealtimeObservationMapper.Result r =
                mapper.map(msg("observation", T0.plusMillis(5000), obs(9, 4500, 5000, "running", true, 0.1)));
        // 시작 시각 = produced_at - end_ms = T0 → 판정 시각 = T0 + 5000ms
        assertThat(r.event().get().capturedAt()).isEqualTo(T0.plusMillis(5000).toString());
        // 이후 구간은 추정한 시작 시각(T0)을 계속 쓴다 — produced_at이 늦어도 영향 없음
        RealtimeObservationMapper.Result next =
                mapper.map(msg("observation", T0.plusMillis(5600), obs(10, 5000, 5500, "running", true, 0.1)));
        assertThat(next.event().get().capturedAt()).isEqualTo(T0.plusMillis(5500).toString());
    }

    @Test
    void sessionEndedForgetsStartAndCapacityIsBounded() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 2);
        mapper.map(msg("session_started", T0, new HashMap<>()));
        mapper.map(msg("session_ended", T0.plusSeconds(3), new HashMap<>(Map.of("end_ms", 3000))));
        assertThat(mapper.trackedSessions()).isEqualTo(0);
        for (int i = 0; i < 5; i++) {
            Map<String, Object> m = msg("session_started", T0, new HashMap<>());
            m.put("session_id", "s" + i);
            mapper.map(m);
        }
        assertThat(mapper.trackedSessions()).isEqualTo(2);
    }

    @Test
    void badInputIsIgnoredNotThrown() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 100);
        Map<String, Object> noSession = msg("observation", T0, obs(0, 0, 500, "running", true, 0.9));
        noSession.remove("session_id");
        assertThat(mapper.map(noSession).kind()).isEqualTo(RealtimeObservationMapper.Kind.IGNORED);
        Map<String, Object> noEnd = obs(0, 0, 500, "running", true, 0.9);
        noEnd.remove("end_ms");
        assertThat(mapper.map(msg("observation", T0, noEnd)).kind()).isEqualTo(RealtimeObservationMapper.Kind.IGNORED);
        assertThat(mapper.map(msg("decision", T0, new HashMap<>())).kind()).isEqualTo(RealtimeObservationMapper.Kind.IGNORED);
    }

    /**
     * T-10과 같은 시나리오(정상 5초 → 나쁜 자세 70초 → 회복 10초)를 0.5초 구간으로 넣으면
     * 판정 결과가 확정 → 재알림(2회) → 종료로 나온다. 서버 재생(replay_realtime_v1.py)의 기대값 근거.
     */
    @Test
    void t10ScenarioWithHalfSecondSegments() {
        RealtimeObservationMapper mapper = new RealtimeObservationMapper(0.7, 100);
        PostureCepEngine engine = new PostureCepEngine(3, 3, 60);
        mapper.map(msg("session_started", T0, new HashMap<>()));
        List<CepOutcome> outcomes = new ArrayList<>();
        long seq = 0;
        long t = 0;
        double[][] phases = {{5, 0.23}, {70, 1.0}, {10, 0.23}};   // 초, 점수
        for (double[] p : phases) {
            for (int i = 0; i < p[0] * 2; i++) {
                RealtimeObservationMapper.Result r = mapper.map(
                        msg("observation", T0.plusMillis(t + 520), obs(seq++, t, t + 500, "running", true, p[1])));
                engine.handle(r.event().get()).ifPresent(outcomes::add);
                t += 500;
            }
        }
        assertThat(outcomes).extracting(CepOutcome::type).containsExactly(
                CepOutcome.Type.EVENT_STARTED, CepOutcome.Type.RE_ALERT, CepOutcome.Type.EVENT_ENDED);
        CepOutcome ended = outcomes.get(2);
        assertThat(ended.alertCount()).isEqualTo(2);
        assertThat(ended.recovered()).isTrue();
        assertThat(ended.startedAt()).isEqualTo(T0.plusMillis(5500));   // 첫 나쁜 구간의 끝
        // 첫 나쁜 구간 끝(5.5s) ~ 회복 3초 확인 구간 끝(78.5s) = 73.0s
        assertThat(ended.durationSeconds()).isEqualTo(73.0);
    }
}
