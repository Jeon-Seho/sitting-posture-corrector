package org.posegood.api.engine;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 세션 하나의 판정 엔진: 받은 좌표 구간과 추론 결과를 모아 두었다가 약 3초마다 순서대로 판정하고(계획 0064), 시간을
 * 누적해 판정 사건을 만든다.
 *
 * 구간은 받는 즉시 자리를 잡고({@link #hold}) 추론 결과로 채운다({@link #fill}). 결과는 HTTP면 바로, Kafka면 나중에
 * 순서와 상관없이 온다. 판정({@link #judge})은 앞에서부터 채워진 자리까지만 하고, 결과가 오래 오지 않은 자리는 누락으로
 * 버린다. 언제 판정할지는 서버 시계로 정하고({@link #due}), 시간 규칙은 프레임 촬영 시각({@code t_ms})으로 센다.
 *
 * 입력 순서·중복·공백 처리, 중단 시 초기화 정책({@code legacy-interrupt-v1}), 통계는 예전 CEP와 같다.
 * 임계값 비교는 {@link DecisionRules}에만 있다(ADR 0020).
 */
public final class SessionEngine {
    /**
     * 기본 최대 측정 시간: 계약의 시각 상한(24시간, {@code *_ms} 최대 86,400,000)과 같다. 제품 한도는 두지 않고
     * 측정불가가 이어지면 끝낸다({@link #unmeasurableMs}, 2026-10-26 결정).
     */
    public static final long DEFAULT_MAX_MS = 86_400_000;
    /** 재전송 확인에 기억하는 최근 구간 수(0.5초 구간이면 1분). 메모리가 측정 시간에 따라 늘지 않게 한다. */
    public static final int RETRY_WINDOW = 120;

    private final UUID id;
    private final Policy policy;
    private final long maxMs;
    private final Timeline timeline = new Timeline();
    private final EpisodeLedger episodes;
    /** 순번마다 받은 구간 조각(재전송 대조용). */
    private final Map<Long, List<Observation>> accepted = recent(RETRY_WINDOW);
    /** 사건마다 그 직후의 요약(실시간 decision 메시지용). */
    private final List<Summary> eventSummaries = new ArrayList<>();
    /** 받았지만 아직 판정하지 않은 구간(결과를 기다리거나 묶음이 차기를 기다림). */
    private final PendingIntervals pending = new PendingIntervals();
    private long lastSequence = -1;
    private boolean ended;
    private Observation current;
    private long unmeasurableMs;

    public SessionEngine(UUID id, Policy policy) {
        this(id, policy, DEFAULT_MAX_MS);
    }

    /** {@code maxMs}: 한 세션에서 측정할 수 있는 최대 시간(세션 시작부터, 설정값). 넘는 구간은 429. */
    public SessionEngine(UUID id, Policy policy, long maxMs) {
        if (maxMs <= 0) throw new IllegalArgumentException("maximum session time must be positive");
        this.id = id;
        this.policy = policy;
        this.maxMs = maxMs;
        episodes = new EpisodeLedger(id);
    }

    /** 가장 오래된 것부터 지우며 최근 {@code size}개만 두는 순번 → 값 맵. */
    public static <V> Map<Long, V> recent(int size) {
        return new LinkedHashMap<>() {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Long, V> eldest) {
                return size() > size;
            }
        };
    }

    /**
     * 관측 한 구간 처리: 중복·역순 확인 → 빈 시간은 누락 처리 →
     * 측정 불가면 제외 시간, 측정되면 시간 누적 후 규칙 판정.
     */
    public synchronized SessionView accept(Observation observation) {
        return accept(List.of(observation));
    }

    /**
     * 좌표 구간 하나를 프레임별 조각으로 처리한다(계획 0064): 순서·중복·누락은 구간 단위로 보고, 시간 누적과 규칙
     * 판정은 조각마다 한다. 조각은 같은 순번·같은 phase이고 빈틈없이 이어져야 한다.
     *
     * 판정 불가 조각은 지금처럼 연속 시간을 끊는다(중단 후 초기화).
     */
    public synchronized SessionView accept(List<Observation> parts) {
        var first = requireParts(parts);
        var last = parts.get(parts.size() - 1);
        var duplicate = accepted.get(first.sequence());
        if (duplicate != null) {
            if (!duplicate.equals(parts)) throw ApiError.conflict("conflicting duplicate");
            return view();
        }
        if (ended) throw ApiError.ended();
        if (first.sequence() <= lastSequence || first.startMs() < timeline.endMs())
            throw ApiError.conflict("out-of-order or overlapping interval");
        if (!admits(last.endMs())) throw ApiError.limit("session time limit reached");

        // 빈 시간은 누락으로 제외한다. 순번만 빠졌으면 시간을 만들지 않고 연속성만 끊는다.
        if (first.startMs() > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(first.startMs());
        } else if (lastSequence >= 0 && first.sequence() != lastSequence + 1) {
            interrupt("missing_sequence", timeline.endMs());
        }

        for (var part : parts) take(part);
        accepted.put(first.sequence(), List.copyOf(parts));
        lastSequence = first.sequence();
        return view();
    }

    /**
     * 받은 좌표 구간 하나의 자리를 잡는다(판정은 {@link #judge}). 추론할 프레임이 있으면 true이고, 없으면(쉬기·자리 비움·빈
     * 구간) 호출한 쪽이 빈 결과로 바로 채운다.
     *
     * 같은 순번·앞선 순번·겹치는 시간은 409, 최대 측정 시간을 넘으면 429, 끝난 세션이면 SESSION_ENDED다.
     */
    public synchronized boolean hold(FrameInterval interval, long now) {
        if (ended) throw ApiError.ended();
        if (interval.sequence() <= heldSequence() || interval.startMs() < heldEndMs())
            throw ApiError.conflict("duplicate, out-of-order or overlapping interval");
        if (!admits(interval.endMs())) throw ApiError.limit("session time limit reached");
        pending.add(new PendingIntervals.Slot(interval, now));
        return !FrameParts.frames(interval).isEmpty();
    }

    /**
     * 자리 하나를 추론 결과로 채운다. {@code results}는 {@link FrameParts#frames} 순서다. 자리가 없거나(이미 판정·누락) 이미
     * 채워졌으면 false다.
     */
    public synchronized boolean fill(long sequence, List<FrameInference.Result> results, String modelVersion) {
        var slot = pending.find(sequence);
        if (slot == null || slot.settled()) return false;
        slot.results = List.copyOf(results);
        slot.modelVersion = modelVersion;
        notifyAll();
        return true;
    }

    /** 추론이 실패한 자리: 결과를 기다리지 않고 다음 판정 때 누락으로 버린다. */
    public synchronized void fail(long sequence) {
        var slot = pending.find(sequence);
        if (slot == null || slot.settled()) return;
        slot.failed = true;
        notifyAll();
    }

    /** 자리의 추론 프레임({@link FrameParts#frames}). 결과를 요청과 대조할 때 쓴다. 자리가 없으면 null. */
    public synchronized List<FrameInterval.Frame> heldFrames(long sequence) {
        var slot = pending.find(sequence);
        return slot == null ? null : FrameParts.frames(slot.interval);
    }

    /**
     * 판정할 때인지(서버 시계 {@code now}): 묶음이 {@code windowNanos}를 모았거나, 쉬기·자리 비움이 들어왔거나, 결과를
     * 기다리던 자리가 채워졌거나 {@code waitNanos}를 넘겼다.
     */
    public synchronized boolean due(long now, long windowNanos, long waitNanos) {
        return !ended && pending.due(now, windowNanos, waitNanos);
    }

    /**
     * 모은 구간을 앞에서부터 판정한다. 채워진 자리는 프레임별 조각으로 판정하고, 실패했거나 {@code waitNanos}를 넘겨
     * 기다린 자리는 버린다(그 시간은 다음 구간이 올 때 누락이 된다). 아직 기다릴 자리에서 멈춘다. {@code force}면
     * 기다리지 않고 남은 자리를 모두 처리한다(종료·끊김·자정).
     *
     * 측정불가가 {@code unmeasurableTimeoutMs}(0이면 끔) 이어지면 그 구간 끝에서 세션을 끝내고 남은 자리는 버린다.
     */
    public synchronized Batch judge(long now, long waitNanos, boolean force, long unmeasurableTimeoutMs) {
        var results = new ArrayList<FrameInference.Result>();
        int judged = 0, dropped = 0;
        boolean timedOut = false, waiting = false;
        while (!pending.isEmpty() && !ended) {
            var head = pending.head();
            if (head.filled()) {
                pending.poll();
                accept(FrameParts.parts(head.interval, head.results, head.modelVersion));
                results.addAll(head.results);
                judged++;
                if (unmeasurableTimeoutMs > 0 && unmeasurableMs >= unmeasurableTimeoutMs) {
                    end(timeline.endMs());
                    timedOut = true;
                }
            } else if (head.failed || force || now - head.heldAt >= waitNanos) {
                pending.poll();
                dropped++;
            } else {
                waiting = true;
                break;
            }
        }
        if (ended) pending.clear();
        else pending.judged(now, waiting);
        return new Batch(List.copyOf(results), judged, dropped, timedOut);
    }

    /** 모든 자리의 결과가 오거나 실패할 때까지 기다린다(서버 시계 {@code deadline}까지). 다 왔으면 true. */
    public synchronized boolean awaitSettled(long deadline) {
        while (!pending.allSettled()) {
            long left = deadline - System.nanoTime();
            if (left <= 0) return false;
            try {
                TimeUnit.NANOSECONDS.timedWait(this, left);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return true;
    }

    /** 받은 마지막 순번: 모은 구간이 있으면 그 끝, 없으면 판정한 마지막 순번. */
    public synchronized long heldSequence() {
        return pending.isEmpty() ? lastSequence : pending.last().interval.sequence();
    }

    private long heldEndMs() {
        return pending.isEmpty() ? timeline.endMs() : pending.last().interval.endMs();
    }

    /** 실시간 관측 4.0의 {@code posture}: 이 점수가 세션 임계값 이상이면 bad. */
    public String posture(double collapseProbability) {
        return DecisionRules.candidate(collapseProbability, policy) ? "bad" : "good";
    }

    private void take(Observation part) {
        current = part;
        countUnmeasurable(part);
        if (part.phase() != Observation.Phase.running || !part.valid()) {
            String reason = part.phase() == Observation.Phase.running ? "unmeasurable" : part.phase().name();
            interrupt(reason, part.startMs());
            timeline.addExcluded(part);
        } else {
            boolean candidate = DecisionRules.candidate(part.collapseProbability(), policy);
            timeline.addMeasured(part, candidate);
            apply(
                    DecisionRules.evaluate(
                            candidate,
                            episodes.active(),
                            timeline.holdMs(),
                            timeline.recoveryMs(),
                            episodes.sinceAlertMs(timeline.endMs()),
                            policy));
        }
    }

    private static Observation requireParts(List<Observation> parts) {
        if (parts.isEmpty()) throw new IllegalArgumentException("an interval needs at least one part");
        var first = parts.get(0);
        for (int index = 1; index < parts.size(); index++) {
            var previous = parts.get(index - 1);
            var part = parts.get(index);
            if (part.sequence() != first.sequence()
                    || part.phase() != first.phase()
                    || part.startMs() != previous.endMs())
                throw new IllegalArgumentException("parts must be one contiguous interval");
        }
        return first;
    }

    /**
     * 세션 종료: 남은 빈 시간을 누락으로 넣고 열린 사건을 끝낸다.
     *
     * 같은 시각으로 다시 끝내면 같은 결과, 다른 시각이면 409.
     */
    public synchronized SessionView end(long at) {
        if (ended) {
            if (at != timeline.endMs()) throw ApiError.conflict("conflicting session end");
            return view();
        }
        if (at < timeline.endMs()) throw ApiError.conflict("end precedes last observation");
        if (at > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(at);
        }
        interrupt("ended", timeline.endMs());
        ended = true;
        pending.clear();
        episodes.end(at, timeline.validMs());
        snapshot();
        return view();
    }

    /** 현재 상태를 조회 응답으로 만든다. */
    public synchronized SessionView view() {
        return new SessionView(
                "1.0",
                id,
                policy,
                SessionView.TIMER_POLICY,
                ended,
                lastSequence,
                summary(),
                episodes.events());
    }

    public synchronized Summary summary() {
        return timeline.summary(episodes.statistics());
    }

    /**
     * 실시간 재전송용: 해당 ID 뒤의 사건과 그때의 요약.
     */
    public synchronized List<Decided> eventsAfter(long eventId) {
        var result = new ArrayList<Decided>();
        for (int index = 0; index < episodes.size(); index++) {
            var event = episodes.event(index);
            if (event.eventId() > eventId) result.add(new Decided(event, eventSummaries.get(index)));
        }
        return result;
    }

    public synchronized List<ExcludedSpan> excluded() {
        return timeline.excluded();
    }

    public synchronized boolean ended() {
        return ended;
    }

    public synchronized long lastSequence() {
        return lastSequence;
    }

    /** {@code endMs}에서 끝나는 새 구간을 받을 수 있는지: 최대 측정 시간 안이다. */
    public synchronized boolean admits(long endMs) {
        return endMs <= maxMs;
    }

    /**
     * 측정불가가 이어진 시간: 판정 불가({@code running}인데 유효하지 않음)와 자리 비움({@code away}) 구간 길이의 합.
     *
     * 유효한 측정 구간이나 사용자가 누른 쉬기({@code rest})가 오면 0이 된다. 구간 사이 빈 시간(누락)은 더하지도
     * 지우지도 않는다.
     */
    public synchronized long unmeasurableMs() {
        return unmeasurableMs;
    }

    /**
     * 측정이 멈춘 이유(실시간 v2 {@code progress.paused_reason}): 마지막 구간이 휴식이면 {@code rest},
     * 카메라 끊김이면 {@code away}, 판정 불가면 {@code unmeasurable}, 측정 중이거나 아직 구간이 없으면 null.
     */
    public synchronized String pausedReason() {
        if (current == null) return null;
        if (current.phase() != Observation.Phase.running) return current.phase().name();
        return current.valid() ? null : "unmeasurable";
    }

    public synchronized int eventCount() {
        return episodes.size();
    }

    public Policy policy() {
        return policy;
    }

    private void apply(DecisionRules.Decision decision) {
        switch (decision) {
            case NONE -> {
                return;
            }
            case COLLAPSE_CONFIRMED ->
                    episodes.confirmCollapse(
                            timeline.endMs(),
                            timeline.onsetMs(),
                            timeline.onsetValidMs(),
                            current.deviationType().name());
            case REMINDER -> episodes.remind(timeline.endMs());
            case RECOVERY_CONFIRMED -> {
                episodes.confirmRecovery(timeline.endMs());
                timeline.resetRecovery();
            }
        }
        snapshot();
    }

    /**
     * 열린 사건을 끝내고 연속 누적 시간을 0으로 만든다.
     *
     * 일시정지·재개가 아니라 중단 후 초기화 정책이다.
     */
    private void interrupt(String reason, long at) {
        episodes.interrupt(reason, at);
        timeline.resetContinuity();
        snapshot();
    }

    private void countUnmeasurable(Observation observation) {
        boolean unmeasurable =
                observation.phase() == Observation.Phase.away
                        || (observation.phase() == Observation.Phase.running && !observation.valid());
        unmeasurableMs = unmeasurable ? unmeasurableMs + observation.endMs() - observation.startMs() : 0;
    }

    private void snapshot() {
        while (eventSummaries.size() < episodes.size()) eventSummaries.add(summary());
    }

    public record Decided(DecisionEvent event, Summary summary) {}

    /**
     * 판정 한 번의 결과: 판정한 프레임 결과(관측 4.0용), 판정한 구간 수, 버린 구간 수(추론 실패·결과 없음), 측정불가
     * 시간 초과로 끝냈는지.
     */
    public record Batch(List<FrameInference.Result> results, int judged, int dropped, boolean timedOut) {}
}
