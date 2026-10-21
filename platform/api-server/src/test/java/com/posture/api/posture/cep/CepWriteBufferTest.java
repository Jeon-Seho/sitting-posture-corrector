package com.posture.api.posture.cep;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * (D-18) DB 쓰기 버퍼 단위테스트. 실제 DB 대신 실패를 흉내 낼 수 있는 가짜 대상과
 * 손으로 움직이는 시계를 써서, "DB가 멈춰도 판정 경로는 막히지 않고 기록은 보관됐다가
 * 복구 후 반영된다"를 확인한다.
 */
class CepWriteBufferTest {

    private static final Instant BASE = Instant.parse("2026-01-01T00:00:00Z");

    /** 실패 여부를 바꿀 수 있는 가짜 DB. 받은 묶음을 그대로 기록해 둔다. */
    static final class FakeTarget implements CepWriteTarget {
        boolean failing;
        int sessionCalls;
        int eventCalls;
        final List<SessionTouch> sessions = new ArrayList<>();
        final List<EventRow> events = new ArrayList<>();

        @Override
        public void upsertSessions(List<SessionTouch> touches) {
            sessionCalls++;
            if (failing) {
                throw new IllegalStateException("Access denied (테스트)");
            }
            sessions.addAll(touches);
        }

        @Override
        public void upsertEvents(List<EventRow> rows) {
            eventCalls++;
            if (failing) {
                throw new IllegalStateException("Access denied (테스트)");
            }
            events.addAll(rows);
        }
    }

    private final AtomicLong now = new AtomicLong(1_000_000L);
    private final FakeTarget target = new FakeTarget();

    private CepWriteBuffer newBuffer(int eventCapacity) {
        return new CepWriteBuffer(target, 1000, eventCapacity, 30_000, now::get);
    }

    private static InferenceEvent sample(String sessionId, double offsetSeconds) {
        return new InferenceEvent(sessionId, "user-1", "BAD",
                BASE.plusMillis(Math.round(offsetSeconds * 1000)).toString());
    }

    private static EventRow row(String sessionId, int startSec, int alertCount, boolean ended) {
        Instant start = BASE.plusSeconds(startSec);
        return new EventRow(sessionId, "user-1", start,
                ended ? start.plusSeconds(70) : null, ended ? 70.0 : null,
                alertCount, start, ended, !ended);
    }

    @Test
    void samplesOfSameSessionAreMergedIntoOneRow() {
        CepWriteBuffer buffer = newBuffer(100);
        buffer.recordSample(sample("s1", 2.0));
        buffer.recordSample(sample("s1", 0.5));
        buffer.recordSample(sample("s1", 1.0));
        buffer.recordSample(sample("s2", 0.0));

        // 판정 경로에서 부르는 동안에는 DB를 전혀 건드리지 않는다
        assertThat(target.sessionCalls).isEqualTo(0);

        assertThat(buffer.flush()).isTrue();
        assertThat(target.sessions).hasSize(2);
        SessionTouch s1 = target.sessions.stream().filter(t -> t.sessionId().equals("s1")).findFirst().orElseThrow();
        assertThat(s1.samples()).isEqualTo(3);
        assertThat(s1.firstSeen()).isEqualTo(BASE.plusMillis(500));
        assertThat(s1.lastSeen()).isEqualTo(BASE.plusMillis(2000));
        assertThat(buffer.status().get("pendingSessions")).isEqualTo(0);
    }

    @Test
    void latestStateOfSameEventWins() {
        CepWriteBuffer buffer = newBuffer(100);
        buffer.offerEvent(row("s1", 10, 1, false));   // 확정
        buffer.offerEvent(row("s1", 10, 2, false));   // 재알림
        buffer.offerEvent(row("s1", 10, 2, true));    // 종료
        buffer.flush();
        assertThat(target.events).hasSize(1);
        assertThat(target.events.get(0).alertCount()).isEqualTo(2);
        assertThat(target.events.get(0).recovered()).isTrue();
    }

    @Test
    void dbFailureKeepsRecordsAndRetriesAfterBackoff() {
        CepWriteBuffer buffer = newBuffer(100);
        target.failing = true;
        buffer.recordSample(sample("s1", 0.0));
        buffer.offerEvent(row("s1", 0, 1, false));

        assertThat(buffer.flush()).isTrue();              // 1회 실패
        Map<String, Object> st = buffer.status();
        assertThat(st.get("consecutiveFailures")).isEqualTo(1);
        assertThat(st.get("pendingSessions")).isEqualTo(1);
        assertThat(st.get("pendingEvents")).isEqualTo(1);
        assertThat(target.eventCalls).isEqualTo(0);       // 세션 쓰기가 실패하면 이벤트는 시도하지 않음

        // 실패 중에도 판정 경로는 계속 넣을 수 있다 (막히지 않음)
        buffer.recordSample(sample("s1", 5.0));
        buffer.offerEvent(row("s1", 0, 2, true));

        // 재시도 대기(1초) 전에는 시도하지 않는다
        now.addAndGet(500);
        assertThat(buffer.flush()).isFalse();
        assertThat(target.sessionCalls).isEqualTo(1);

        // DB 복구 후 대기 시간이 지나면 보관분이 합쳐져 한 번에 반영된다
        target.failing = false;
        now.addAndGet(600);
        assertThat(buffer.flush()).isTrue();
        assertThat(target.sessions).hasSize(1);
        assertThat(target.sessions.get(0).samples()).isEqualTo(2);
        assertThat(target.sessions.get(0).lastSeen()).isEqualTo(BASE.plusSeconds(5));
        assertThat(target.events).hasSize(1);
        assertThat(target.events.get(0).recovered()).isTrue();   // 더 새 상태(종료)가 남음
        assertThat(buffer.status().get("consecutiveFailures")).isEqualTo(0);
        assertThat(buffer.status().get("lastError")).isNull();
    }

    @Test
    void backoffGrowsAndIsCapped() {
        CepWriteBuffer buffer = new CepWriteBuffer(target, 1000, 100, 4000, now::get);
        target.failing = true;
        buffer.recordSample(sample("s1", 0.0));
        long[] expectedWaits = {1000, 2000, 4000, 4000};
        for (long wait : expectedWaits) {
            assertThat(buffer.flush()).isTrue();
            now.addAndGet(wait - 1);
            assertThat(buffer.flush()).isFalse();         // 아직 대기 중
            now.addAndGet(1);
        }
        assertThat(buffer.status().get("consecutiveFailures")).isEqualTo(4);
    }

    @Test
    void eventCapacityDropsOldestFirst() {
        CepWriteBuffer buffer = newBuffer(2);
        buffer.offerEvent(row("s1", 0, 1, false));
        buffer.offerEvent(row("s2", 0, 1, false));
        buffer.offerEvent(row("s3", 0, 1, false));
        assertThat(buffer.status().get("droppedEvents")).isEqualTo(1L);
        buffer.flush();
        assertThat(target.events.stream().map(EventRow::sessionId).toList()).containsExactly("s2", "s3");
    }

    @Test
    void engineOutcomeIsSnapshottedAtRecordTime() {
        // 엔진이 돌려준 결과를 기록한 뒤 엔진 내부 객체가 바뀌어도, 기록된 값은 그대로여야 한다
        PostureCepEngine engine = new PostureCepEngine(3, 3, 60);
        CepWriteBuffer buffer = newBuffer(100);
        Optional<CepOutcome> started = Optional.empty();
        for (int i = 0; i <= 40; i++) {
            Optional<CepOutcome> o = engine.handle(new InferenceEvent("s1", "user-1", "BAD",
                    BASE.plusMillis(i * 100L).toString()));
            if (o.isPresent() && started.isEmpty()) {
                started = o;
                buffer.recordEvent(o.get());
            }
        }
        assertThat(started).isPresent();
        // 회복시켜 엔진 쪽 이벤트를 종료 상태로 바꾼다
        for (int i = 41; i <= 80; i++) {
            engine.handle(new InferenceEvent("s1", "user-1", "NORMAL", BASE.plusMillis(i * 100L).toString()));
        }
        buffer.flush();
        assertThat(target.events).hasSize(1);
        assertThat(target.events.get(0).ongoing()).isTrue();
        assertThat(target.events.get(0).endedAt()).isNull();
    }
}
