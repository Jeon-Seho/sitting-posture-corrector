package com.posture.api.posture.cep.v1;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-22) 세션별 판정기 모음 — 발행 순서, 정책, 종료·만료 정리. */
class V1JudgeRegistryTest {

    static final String SID = "00000000-0000-4000-8000-0000000000a1";

    record Sent(String sessionId, String userId, String kind, Map<String, Object> body) {
    }

    static final class MemorySink implements EpisodesSink {
        final List<Sent> sent = new ArrayList<>();

        @Override
        public void publish(String sessionId, String userId, String kind, Map<String, Object> body) {
            sent.add(new Sent(sessionId, userId, kind, body));
        }

        List<Object> kinds() {
            List<Object> k = new ArrayList<>();
            for (Sent s : sent) {
                k.add(s.kind().equals("decision") ? ((Map<?, ?>) s.body().get("event")).get("kind") : "progress");
            }
            return k;
        }
    }

    final AtomicLong now = new AtomicLong(1_000_000);
    final MemorySink sink = new MemorySink();
    final V1JudgeRegistry registry = new V1JudgeRegistry(sink, new V1Policy(3000, 3000, 60000, 0.7), now::get);

    static Map<String, Object> obs(long seq, long start, long end, double p) {
        Map<String, Object> b = new HashMap<>();
        b.put("schema_version", "2.0");
        b.put("sequence", seq);
        b.put("start_ms", start);
        b.put("end_ms", end);
        b.put("phase", "running");
        b.put("valid", true);
        b.put("collapse_probability", p);
        b.put("deviation_type", "left_lean");
        b.put("model_version", "reference-feature-rule-v1");
        return b;
    }

    @Test
    void decisionIsPublishedBeforeTheProgressThatIncludesIt() {
        registry.sessionStarted(SID, "u1", Map.of("policy",
                Map.of("hold_ms", 1000, "recovery_ms", 1000, "reminder_ms", 60000, "threshold", 0.7)));
        registry.observation(SID, "u1", obs(0, 0, 500, 0.9));
        registry.observation(SID, "u1", obs(1, 500, 1000, 0.9));   // 1.0s: 확정 + progress
        assertThat(sink.kinds()).containsExactly("collapse_confirmed", "progress");
        Sent d = sink.sent.get(0);
        assertThat(d.userId()).isEqualTo("u1");
        assertThat(((Map<?, ?>) d.body().get("event")).get("deviation_type")).isEqualTo("left_lean");
    }

    @Test
    void endPublishesFinalDecisionsAndKeepsRecentView() {
        registry.sessionStarted(SID, "u1", Map.of());
        for (int i = 0; i < 4; i++) {
            registry.observation(SID, "u1", obs(i, i * 500L, i * 500L + 500, 0.1));
        }
        sink.sent.clear();
        registry.sessionEnded(SID, "u1", Map.of("end_ms", 2000));
        assertThat(sink.kinds()).containsExactly("session_ended", "progress");
        assertThat(registry.status().get("activeSessions")).isEqualTo(0);
        Map<String, Object> view = registry.view(SID).orElseThrow();
        assertThat(view.get("ended")).isEqualTo(true);
        assertThat(((List<?>) view.get("events"))).hasSize(1);
    }

    @Test
    void observationWithoutStartUsesDefaultPolicy() {
        registry.observation(SID, "u1", obs(0, 0, 500, 0.9));
        assertThat(registry.status().get("activeSessions")).isEqualTo(1);
        assertThat(registry.view(SID).isPresent()).isTrue();
    }

    @Test
    void duplicateIsSkippedAndNotPublished() {
        registry.observation(SID, "u1", obs(0, 0, 1000, 0.1));
        int before = sink.sent.size();
        assertThat(registry.observation(SID, "u1", obs(0, 0, 1000, 0.1))).isNotNull();
        assertThat(sink.sent).hasSize(before);
        assertThat(registry.status().get("skippedObservations")).isEqualTo(1L);
    }

    @Test
    void staleSessionsExpireWithInterruption() {
        for (int i = 0; i < 6; i++) {
            registry.observation(SID, "u1", obs(i, i * 500L, i * 500L + 500, 0.9));
        }
        assertThat(registry.expireStale(300)).isEqualTo(0);
        now.addAndGet(301_000);
        sink.sent.clear();
        assertThat(registry.expireStale(300)).isEqualTo(1);
        assertThat(sink.kinds()).containsExactly("interrupted");
        assertThat(((Map<?, ?>) sink.sent.get(0).body().get("event")).get("reason")).isEqualTo("missing");
        assertThat(registry.status().get("activeSessions")).isEqualTo(0);
    }

    @Test
    void badObservationThrowsForDlq() {
        Map<String, Object> bad = obs(0, 500, 500, 0.9);   // end <= start
        boolean thrown = false;
        try {
            registry.observation(SID, "u1", bad);
        } catch (IllegalArgumentException exc) {
            thrown = true;
        }
        assertThat(thrown).isTrue();
    }
}
