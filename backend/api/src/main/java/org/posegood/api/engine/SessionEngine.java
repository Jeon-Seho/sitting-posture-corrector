package org.posegood.api.engine;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 세션 하나의 판정 엔진: 관측을 순서대로 받아 시간을 누적하고 판정 사건을 만든다.
 *
 * 입력 순서·중복·공백 처리, 중단 시 초기화 정책({@code legacy-interrupt-v1}), 통계는 예전 CEP와 같다.
 * 임계값 비교는 {@link DecisionRules}에만 있다(ADR 0012, ADR 0020).
 */
public final class SessionEngine {
    /** 기본 최대 측정 시간: 예전 관측 10,000건 한도와 같은 0.5초 구간 10,000개(약 83분). */
    public static final long DEFAULT_MAX_MS = 5_000_000;
    /** 메모리 보호: 최대 측정 시간 동안 평균 0.25초 구간까지 받는다. */
    private static final long MIN_AVERAGE_INTERVAL_MS = 250;

    private final UUID id;
    private final Policy policy;
    private final long maxMs;
    private final long maxObservations;
    private final Timeline timeline = new Timeline();
    private final EpisodeLedger episodes;
    private final Map<Long, Observation> accepted = new HashMap<>();
    /** 사건마다 그 직후의 요약(실시간 decision 메시지용). */
    private final List<Summary> eventSummaries = new ArrayList<>();
    private long lastSequence = -1;
    private boolean ended;
    private Observation current;

    public SessionEngine(UUID id, Policy policy) {
        this(id, policy, DEFAULT_MAX_MS);
    }

    /** {@code maxMs}: 한 세션에서 측정할 수 있는 최대 시간(세션 시작부터, 설정값). 넘는 구간은 429. */
    public SessionEngine(UUID id, Policy policy, long maxMs) {
        if (maxMs <= 0) throw new IllegalArgumentException("maximum session time must be positive");
        this.id = id;
        this.policy = policy;
        this.maxMs = maxMs;
        maxObservations = Math.max(1, maxMs / MIN_AVERAGE_INTERVAL_MS);
        episodes = new EpisodeLedger(id);
    }

    /**
     * 관측 한 구간 처리: 중복·역순 확인 → 빈 시간은 누락 처리 →
     * 측정 불가면 제외 시간, 측정되면 시간 누적 후 규칙 판정.
     */
    public synchronized SessionView accept(Observation observation) {
        var duplicate = accepted.get(observation.sequence());
        if (duplicate != null) {
            if (!duplicate.equals(observation)) throw ApiError.conflict("conflicting duplicate");
            return view();
        }
        if (ended) throw ApiError.ended();
        if (observation.sequence() <= lastSequence || observation.startMs() < timeline.endMs())
            throw ApiError.conflict("out-of-order or overlapping interval");
        if (!admits(observation.endMs())) throw ApiError.limit("session time limit reached");

        // 빈 시간은 누락으로 제외한다. 순번만 빠졌으면 시간을 만들지 않고 연속성만 끊는다.
        if (observation.startMs() > timeline.endMs()) {
            interrupt("missing", timeline.endMs());
            timeline.addMissing(observation.startMs());
        } else if (lastSequence >= 0 && observation.sequence() != lastSequence + 1) {
            interrupt("missing_sequence", timeline.endMs());
        }

        current = observation;
        if (observation.phase() != Observation.Phase.running || !observation.valid()) {
            String reason =
                    observation.phase() == Observation.Phase.running
                            ? "unmeasurable"
                            : observation.phase().name();
            interrupt(reason, observation.startMs());
            timeline.addExcluded(observation);
        } else {
            boolean candidate = observation.collapseProbability() >= policy.threshold();
            timeline.addMeasured(observation, candidate);
            apply(
                    DecisionRules.evaluate(
                            candidate,
                            episodes.active(),
                            timeline.holdMs(),
                            timeline.recoveryMs(),
                            episodes.sinceAlertMs(timeline.endMs()),
                            policy));
        }
        accepted.put(observation.sequence(), observation);
        lastSequence = observation.sequence();
        return view();
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

    public synchronized int acceptedCount() {
        return accepted.size();
    }

    /** {@code endMs}에서 끝나는 새 구간을 받을 수 있는지: 최대 측정 시간 안이고 메모리 한도 전이다. */
    public synchronized boolean admits(long endMs) {
        return endMs <= maxMs && accepted.size() < maxObservations;
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

    /**
     * 관측 3.0의 {@code invalid_reason}: 유효하면 null. 아니면 API가 좌표에서 찾은 사유
     * ({@code head_turn}), 그 밖에는 {@code unmeasurable}.
     *
     * 계약상 유효하지 않은 구간은 사유가 꼭 있어야 하므로 휴식·자리 비움도 {@code unmeasurable}이고, 멈춘 이유는
     * {@link #pausedReason}이 알려 준다. {@code settling}은 언제 나오는지 정해지지 않아 아직 쓰지 않는다.
     */
    public static String invalidReason(Observation observation, String hint) {
        if (observation.valid()) return null;
        return observation.phase() == Observation.Phase.running && "head_turn".equals(hint)
                ? "head_turn"
                : "unmeasurable";
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

    private void snapshot() {
        while (eventSummaries.size() < episodes.size()) eventSummaries.add(summary());
    }

    public record Decided(DecisionEvent event, Summary summary) {}
}
