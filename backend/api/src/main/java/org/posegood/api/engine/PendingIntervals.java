package org.posegood.api.engine;

import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

/**
 * 판정 엔진이 모으는 묶음(계획 0084): 받은 좌표 구간의 자리를 순번대로 잡아 두고, 추론 결과가 오면 채운다.
 *
 * 결과는 Kafka로 오면 순서가 바뀔 수 있으므로 판정은 늘 앞에서부터 채워진 자리까지만 한다. 시각은 서버 시계
 * ({@link System#nanoTime})다. 동기화는 {@link SessionEngine}이 한다.
 */
final class PendingIntervals {
    /** 받은 구간 하나의 자리. {@code results}는 결과가 오기 전 null이다. */
    static final class Slot {
        final FrameInterval interval;
        final long heldAt;
        List<FrameInference.Result> results;
        String modelVersion;
        /** 추론이 실패했거나 결과가 계약과 맞지 않았다: 기다리지 않고 누락으로 버린다. */
        boolean failed;

        Slot(FrameInterval interval, long heldAt) {
            this.interval = interval;
            this.heldAt = heldAt;
        }

        boolean filled() {
            return results != null;
        }

        boolean settled() {
            return filled() || failed;
        }
    }

    private final Deque<Slot> slots = new ArrayDeque<>();
    /** 지금 묶음을 모으기 시작한 서버 시각. 비어 있으면 의미 없다. */
    private long windowStart;
    /** 지난 판정이 결과를 기다리는 자리에서 멈췄다: 그 자리가 정해지면 3초를 기다리지 않고 판정한다. */
    private boolean blocked;

    boolean isEmpty() {
        return slots.isEmpty();
    }

    Slot last() {
        return slots.peekLast();
    }

    Slot head() {
        return slots.peekFirst();
    }

    void add(Slot slot) {
        if (slots.isEmpty()) windowStart = slot.heldAt;
        slots.addLast(slot);
    }

    Slot find(long sequence) {
        for (var slot : slots)
            if (slot.interval.sequence() == sequence) return slot;
        return null;
    }

    Slot poll() {
        return slots.pollFirst();
    }

    void clear() {
        slots.clear();
        blocked = false;
    }

    boolean allSettled() {
        for (var slot : slots)
            if (!slot.settled()) return false;
        return true;
    }

    /**
     * 판정할 때인지: 맨 앞 자리가 정해졌고, 묶음이 {@code windowNanos}를 모았거나 쉬기·자리 비움 구간이 들어왔거나 지난
     * 판정이 이 자리를 기다리다 멈췄다. 맨 앞 자리가 {@code waitNanos}를 넘겨 기다렸으면 누락으로 버리러 판정한다.
     */
    boolean due(long now, long windowNanos, long waitNanos) {
        var head = slots.peekFirst();
        if (head == null) return false;
        if (!head.settled()) return now - head.heldAt >= waitNanos;
        if (blocked) return true;
        if (now - windowStart >= windowNanos) return true;
        for (var slot : slots)
            if (slot.interval.phase() != FrameInterval.Phase.running) return true;
        return false;
    }

    /** 판정을 마친 뒤: 남은 자리는 다음 묶음이 된다. 결과를 기다리느라 멈췄으면 표시한다. */
    void judged(long now, boolean stoppedAtWaiting) {
        windowStart = now;
        blocked = stoppedAtWaiting;
    }
}
