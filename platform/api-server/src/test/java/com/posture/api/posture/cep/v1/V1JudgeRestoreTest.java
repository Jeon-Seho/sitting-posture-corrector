package com.posture.api.posture.cep.v1;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-37) v1 판정 상태 저장·복원 — 재시작해도 같은 사건·요약이 나와야 한다. */
class V1JudgeRestoreTest {

    static final String SID = "00000000-0000-4000-8000-0000000000d7";
    static final V1Policy POLICY = new V1Policy(3000, 3000, 60000, 0.7);

    /** T-10과 같은 시나리오: 정상 5s → 나쁜 자세 70s → 정상 10s, 0.5초 구간 170개. */
    static Map<String, Object> t10(int i) {
        double p = i < 10 || i >= 150 ? 0.1 : 0.9;
        return V1JudgeRegistryTest.obs(i, i * 500L, i * 500L + 500, p);
    }

    /** Redis에 JSON으로 썼다가 읽은 것처럼 숫자 타입을 바꾼다(작은 정수는 Integer, 실수는 Double). */
    @SuppressWarnings("unchecked")
    static Object viaJson(Object v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> out.put((String) k, viaJson(x)));
            return out;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            l.forEach(x -> out.add(viaJson(x)));
            return out;
        }
        if (v instanceof Long n && n >= Integer.MIN_VALUE && n <= Integer.MAX_VALUE) {
            return n.intValue();
        }
        return v;
    }

    static final class MemoryStore implements V1JudgeStore {
        final Map<String, Stored> data = new HashMap<>();
        int saves;

        @Override
        @SuppressWarnings("unchecked")
        public Optional<Stored> load(String sessionId) {
            return Optional.ofNullable(data.get(sessionId));
        }

        @Override
        @SuppressWarnings("unchecked")
        public void save(String sessionId, String userId, Map<String, Object> judgeSnapshot) {
            saves++;
            data.put(sessionId, new Stored(userId, (Map<String, Object>) viaJson(judgeSnapshot)));
        }

        @Override
        public void delete(String sessionId) {
            data.remove(sessionId);
        }
    }

    @Test
    void restoredJudgeContinuesExactlyLikeTheOriginal() {
        V1SessionJudge original = new V1SessionJudge(SID, POLICY);
        for (int i = 0; i < 60; i++) {
            original.accept(V1Observation.fromBody(t10(i)));
        }
        @SuppressWarnings("unchecked")
        V1SessionJudge restored = V1SessionJudge.restore((Map<String, Object>) viaJson(original.snapshot()));
        assertThat(restored.view()).isEqualTo(original.view());

        for (int i = 60; i < 170; i++) {
            V1SessionJudge.Result a = original.accept(V1Observation.fromBody(t10(i)));
            V1SessionJudge.Result b = restored.accept(V1Observation.fromBody(t10(i)));
            assertThat(b.decisions()).isEqualTo(a.decisions());
            assertThat(b.progress()).isEqualTo(a.progress());
        }
        assertThat(restored.end(85000).decisions()).isEqualTo(original.end(85000).decisions());
        assertThat(restored.view()).isEqualTo(original.view());
    }

    /** JSON 설정이 null 값을 빼고 쓰는 경우(NON_NULL)에도 같은 상태로 돌아와야 한다. */
    @SuppressWarnings("unchecked")
    static Object dropNulls(Object v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> {
                if (x != null) {
                    out.put((String) k, dropNulls(x));
                }
            });
            return out;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            l.forEach(x -> out.add(dropNulls(x)));
            return out;
        }
        return v;
    }

    @Test
    @SuppressWarnings("unchecked")
    void restoreWorksWhenNullsWereOmitted() {
        V1SessionJudge original = new V1SessionJudge(SID, POLICY);
        for (int i = 0; i < 160; i++) {          // 확정·재알림·복귀까지 (사건 reason은 모두 null)
            original.accept(V1Observation.fromBody(t10(i)));
        }
        V1SessionJudge restored = V1SessionJudge.restore((Map<String, Object>) viaJson(dropNulls(original.snapshot())));
        assertThat(restored.view()).isEqualTo(original.view());
    }

    @Test
    void snapshotWithOtherVersionIsRejected() {
        Map<String, Object> snap = new V1SessionJudge(SID, POLICY).snapshot();
        snap.put("v", 99);
        boolean thrown = false;
        try {
            V1SessionJudge.restore(snap);
        } catch (IllegalArgumentException expected) {
            thrown = true;
        }
        assertThat(thrown).isTrue();
    }

    @Test
    void restartMidEpisodeKeepsEventsAndSkipsRedeliveredMessages() {
        MemoryStore store = new MemoryStore();
        AtomicLong now = new AtomicLong(1_000_000);
        V1JudgeRegistryTest.MemorySink sink1 = new V1JudgeRegistryTest.MemorySink();
        V1JudgeRegistry before = new V1JudgeRegistry(sink1, store, POLICY, now::get);
        before.sessionStarted(SID, "u1", Map.of("policy",
                Map.of("hold_ms", 3000, "recovery_ms", 3000, "reminder_ms", 60000, "threshold", 0.7)));
        for (int i = 0; i < 60; i++) {
            before.observation(SID, "u1", t10(i));
        }
        assertThat(store.data).containsKey(SID);

        // 재시작: 새 등록부, 같은 저장소. Kafka가 커밋 전 메시지(55~59)를 다시 준다.
        V1JudgeRegistryTest.MemorySink sink2 = new V1JudgeRegistryTest.MemorySink();
        V1JudgeRegistry after = new V1JudgeRegistry(sink2, store, POLICY, now::get);
        for (int i = 55; i < 60; i++) {
            assertThat(after.observation(SID, null, t10(i))).contains("이미 반영한 sequence");
        }
        assertThat(sink2.sent).isEmpty();
        for (int i = 60; i < 170; i++) {
            after.observation(SID, null, t10(i));
        }
        after.sessionEnded(SID, null, Map.of("end_ms", 85000));

        List<Object> kinds = new ArrayList<>(sink1.kinds());
        kinds.addAll(sink2.kinds());
        kinds.removeIf("progress"::equals);
        assertThat(kinds).containsExactly("collapse_confirmed", "reminder", "recovery_confirmed", "session_ended");
        Map<String, Object> view = after.view(SID).orElseThrow();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> events = (List<Map<String, Object>>) view.get("events");
        assertThat(events.get(1).get("event_id")).isEqualTo(2L);
        assertThat(events.get(1).get("timestamp_ms")).isEqualTo(68000L);
        assertThat(events.get(2).get("timestamp_ms")).isEqualTo(78000L);
        @SuppressWarnings("unchecked")
        Map<String, Object> summary = (Map<String, Object>) view.get("summary");
        assertThat(summary.get("missing_ms")).isEqualTo(0L);
        assertThat(summary.get("valid_ms")).isEqualTo(85000L);
        assertThat(summary.get("alert_count")).isEqualTo(2L);
        assertThat(sink2.sent.get(0).userId()).isEqualTo("u1");   // 저장된 사용자 ID로 발행
        assertThat(after.status().get("restoredSessions")).isEqualTo(1L);
        assertThat(store.data).doesNotContainKey(SID);            // 종료 후 키 삭제
    }

    @Test
    void withoutStoredStateARestartedSessionStartsOverAsBefore() {
        V1JudgeRegistryTest.MemorySink sink = new V1JudgeRegistryTest.MemorySink();
        V1JudgeRegistry after = new V1JudgeRegistry(sink, new MemoryStore(), POLICY, () -> 0L);
        after.observation(SID, "u1", t10(60));
        @SuppressWarnings("unchecked")
        Map<String, Object> summary = (Map<String, Object>) after.view(SID).orElseThrow().get("summary");
        assertThat(summary.get("missing_ms")).isEqualTo(30000L);   // 앞 30초는 누락으로 셈(D-22 동작)
        assertThat(after.status().get("restoredSessions")).isEqualTo(0L);
    }

    @Test
    void expiryDeletesStoredState() {
        MemoryStore store = new MemoryStore();
        AtomicLong now = new AtomicLong(0);
        V1JudgeRegistry r = new V1JudgeRegistry(new V1JudgeRegistryTest.MemorySink(), store, POLICY, now::get);
        r.sessionStarted(SID, "u1", Map.of());
        r.observation(SID, "u1", t10(0));
        now.set(301_000);
        assertThat(r.expireStale(300)).isEqualTo(1);
        assertThat(store.data).isEmpty();
    }
}
