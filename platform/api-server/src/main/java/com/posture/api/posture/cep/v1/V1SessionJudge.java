package com.posture.api.posture.cep.v1;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * (D-22) 세션 1개의 실시간 계약 v1 판정 — 관측 v2를 받아 사건 v1과 세션 요약을 만든다.
 *
 * <p>시간은 모두 <b>세션 기준 ms(관측의 start_ms/end_ms)</b>로 계산한다(서버 수신 시각을 쓰지 않음).
 * 지속·복귀 시간은 판정 가능한 구간 길이의 누적이다.
 *
 * <ul>
 *   <li>측정 구간(running·valid): 점수 ≥ 정책 threshold면 붕괴 후보. 후보 누적 ≥ hold_ms → {@code collapse_confirmed},
 *       사건 중 정상 누적 ≥ recovery_ms → {@code recovery_confirmed}, 사건 중 마지막 알림부터 ≥ reminder_ms → {@code reminder}.
 *       반대 상태 구간이 하나라도 오면 누적은 0(FE 회신 ③).</li>
 *   <li>제외 구간(running이 아니거나 valid=false): 진행 중 사건을 {@code interrupted}(reason = unmeasurable / rest / away)로 닫고
 *       누적을 0으로. 시간은 unknown/rest/away에 더한다.
 *       — FE 회신 ⑤의 "판정 불가 3초 미만은 시계 멈춤"은 {@code invalid_reason}이 생긴 뒤 D-23에서 바꾼다.</li>
 *   <li>같은 sequence 재전송·이전 sequence·겹치는 구간은 반영하지 않는다(FE 회신 ①). 시간 공백은 missing으로 더하고 사건을 끊는다.</li>
 *   <li>{@code end(at)}: 진행 중 사건을 {@code interrupted}(ended)로 닫고 {@code session_ended}를 낸다.</li>
 * </ul>
 *
 * <p>요약 정의: keep_rate = normal_ms / valid_ms, events_per_hour = collapse_count × 3,600,000 / valid_ms,
 * mean_interval_ms = 연속된 사건 시작(유효 시간 축) 간격 평균, mean_recovery_ms = 첫 알림 → 복귀 확정 평균.
 *
 * <p>스레드 안전: 모든 공개 메서드는 synchronized. 같은 세션은 같은 파티션·같은 스레드로 오지만 관리 API 조회와 겹칠 수 있다.
 */
public final class V1SessionJudge {

    static final Set<String> DEVIATION_TYPES =
            Set.of("none", "forward_slouch", "left_lean", "right_lean", "unspecified");
    static final long PROGRESS_INTERVAL_MS = 1000;

    /** 관측 1개를 처리한 결과. {@code skipped}가 있으면 반영하지 않은 것. */
    public record Result(List<Map<String, Object>> decisions, Map<String, Object> progress, String skipped) {
        static Result skip(String why) {
            return new Result(List.of(), null, why);
        }
    }

    private final String sessionId;
    private final V1Policy policy;

    // 시간 누적 (세션 기준 ms)
    private long endMs;
    private long validMs;
    private long normalMs;
    private long deviationMs;
    private long restMs;
    private long awayMs;
    private long unknownMs;
    private long missingMs;
    private long holdMs;
    private long recoveryMs;
    private long onsetMs;
    private long onsetValidMs;

    // 사건 기록
    private Episode active;
    private Long previousOnsetValid;
    private long eventId;
    private long collapseCount;
    private long alertCount;
    private long intervalCount;
    private long intervalSum;
    private long recoveryCount;
    private long recoverySum;
    private final List<Map<String, Object>> events = new ArrayList<>();

    private long lastSequence = -1;
    private boolean ended;
    private long lastProgressMs;
    private long duplicates;
    private long rejected;
    private String currentDeviationType = "none";

    public V1SessionJudge(String sessionId, V1Policy policy) {
        this.sessionId = sessionId;
        this.policy = policy;
    }

    public synchronized Result accept(V1Observation o) {
        if (ended) {
            rejected++;
            return Result.skip("세션 종료 후 관측");
        }
        if (o.sequence() <= lastSequence) {
            duplicates++;
            return Result.skip("이미 반영한 sequence " + o.sequence() + " (마지막 " + lastSequence + ")");
        }
        if (o.startMs() < endMs) {
            rejected++;
            return Result.skip("구간 겹침 start_ms " + o.startMs() + " < 마지막 end_ms " + endMs);
        }
        List<Map<String, Object>> emitted = new ArrayList<>();

        if (o.startMs() > endMs) {
            interrupt("missing", endMs, emitted);
            missingMs += o.startMs() - endMs;
        } else if (lastSequence >= 0 && o.sequence() != lastSequence + 1) {
            interrupt("missing_sequence", endMs, emitted);
        }

        currentDeviationType = DEVIATION_TYPES.contains(o.deviationType()) ? o.deviationType() : "unspecified";
        long d = o.durationMs();
        if (!"running".equals(o.phase()) || !o.valid()) {
            interrupt("running".equals(o.phase()) ? "unmeasurable" : o.phase(), o.startMs(), emitted);
            endMs = o.endMs();
            switch (o.phase()) {
                case "rest" -> restMs += d;
                case "away" -> awayMs += d;
                default -> unknownMs += d;
            }
        } else {
            boolean candidate = o.collapseProbability() >= policy.threshold();
            endMs = o.endMs();
            if (candidate && holdMs == 0) {
                onsetMs = o.startMs();
                onsetValidMs = validMs;
            }
            validMs += d;
            if (candidate) {
                deviationMs += d;
                holdMs += d;
                recoveryMs = 0;
            } else {
                normalMs += d;
                holdMs = 0;
                recoveryMs += d;
            }
            if (candidate && active == null && holdMs >= policy.holdMs()) {
                confirmCollapse(emitted);
            } else if (!candidate && active != null && recoveryMs >= policy.recoveryMs()) {
                confirmRecovery(emitted);
            } else if (candidate && active != null && endMs - active.lastAlert >= policy.reminderMs()) {
                remind(emitted);
            }
        }
        lastSequence = o.sequence();

        Map<String, Object> summary = summary();
        List<Map<String, Object>> decisions = new ArrayList<>();
        for (Map<String, Object> event : emitted) {
            decisions.add(decisionBody(event, summary));
        }
        Map<String, Object> progress = null;
        if (endMs - lastProgressMs >= PROGRESS_INTERVAL_MS) {
            progress = progressBody(summary);
            lastProgressMs = endMs;
        }
        return new Result(decisions, progress, null);
    }

    /** {@code session_ended}(end_ms) 처리. 이미 끝났으면 건너뜀. */
    public synchronized Result end(long atMs) {
        if (ended) {
            duplicates++;
            return Result.skip("이미 종료된 세션");
        }
        List<Map<String, Object>> emitted = new ArrayList<>();
        long at = Math.max(atMs, endMs);
        if (at > endMs) {
            interrupt("missing", endMs, emitted);
            missingMs += at - endMs;
        }
        interrupt("ended", endMs, emitted);
        endMs = at;
        ended = true;
        emitted.add(event("session_ended", at, at, validMs, "none", "ended"));
        Map<String, Object> summary = summary();
        List<Map<String, Object>> decisions = new ArrayList<>();
        for (Map<String, Object> event : emitted) {
            decisions.add(decisionBody(event, summary));
        }
        lastProgressMs = endMs;
        return new Result(decisions, progressBody(summary), null);
    }

    /** 입력이 끊긴 채 만료될 때: 진행 중 사건만 끊김(missing)으로 닫는다. */
    public synchronized Result expire() {
        List<Map<String, Object>> emitted = new ArrayList<>();
        interrupt("missing", endMs, emitted);
        Map<String, Object> summary = summary();
        List<Map<String, Object>> decisions = new ArrayList<>();
        for (Map<String, Object> event : emitted) {
            decisions.add(decisionBody(event, summary));
        }
        return new Result(decisions, null, null);
    }

    public synchronized boolean ended() {
        return ended;
    }

    public synchronized boolean hasInput() {
        return lastSequence >= 0;
    }

    /** 관리 API용 현재 상태. */
    public synchronized Map<String, Object> view() {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("session_id", sessionId);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("hold_ms", policy.holdMs());
        p.put("recovery_ms", policy.recoveryMs());
        p.put("reminder_ms", policy.reminderMs());
        p.put("threshold", policy.threshold());
        v.put("policy", p);
        v.put("ended", ended);
        v.put("active", active != null);
        v.put("last_sequence", lastSequence);
        v.put("summary", summary());
        v.put("events", List.copyOf(events));
        v.put("duplicates_ignored", duplicates);
        v.put("rejected", rejected);
        return v;
    }

    // ------------------------------------------------------------------

    private void confirmCollapse(List<Map<String, Object>> out) {
        active = new Episode(onsetMs, onsetValidMs, endMs, currentDeviationType);
        collapseCount++;
        alertCount++;
        if (previousOnsetValid != null) {
            intervalCount++;
            intervalSum += onsetValidMs - previousOnsetValid;
        }
        previousOnsetValid = onsetValidMs;
        out.add(episodeEvent("collapse_confirmed", endMs, null));
    }

    private void remind(List<Map<String, Object>> out) {
        alertCount++;
        active.lastAlert = endMs;
        out.add(episodeEvent("reminder", endMs, null));
    }

    private void confirmRecovery(List<Map<String, Object>> out) {
        recoveryCount++;
        recoverySum += endMs - active.firstAlert;
        out.add(episodeEvent("recovery_confirmed", endMs, null));
        active = null;
        recoveryMs = 0;
    }

    private void interrupt(String reason, long at, List<Map<String, Object>> out) {
        if (active != null) {
            out.add(episodeEvent("interrupted", at, reason));
        }
        active = null;
        holdMs = 0;
        recoveryMs = 0;
    }

    private Map<String, Object> episodeEvent(String kind, long at, String reason) {
        return event(kind, at, active.onset, active.onsetValid, active.type, reason);
    }

    private Map<String, Object> event(String kind, long at, long onset, long onsetValid, String type, String reason) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("schema_version", "1.0");
        e.put("session_id", sessionId);
        e.put("event_id", ++eventId);
        e.put("kind", kind);
        e.put("timestamp_ms", at);
        e.put("onset_ms", onset);
        e.put("onset_valid_ms", onsetValid);
        e.put("deviation_type", type);
        e.put("reason", reason);
        events.add(e);
        return e;
    }

    private Map<String, Object> decisionBody(Map<String, Object> event, Map<String, Object> summary) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("last_sequence", lastSequence);
        b.put("event", event);
        b.put("summary", summary);
        return b;
    }

    private Map<String, Object> progressBody(Map<String, Object> summary) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("last_sequence", lastSequence);
        b.put("summary", summary);
        return b;
    }

    Map<String, Object> summary() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("total_ms", endMs);
        s.put("valid_ms", validMs);
        s.put("normal_ms", normalMs);
        s.put("deviation_ms", deviationMs);
        s.put("rest_ms", restMs);
        s.put("away_ms", awayMs);
        s.put("unknown_ms", unknownMs);
        s.put("missing_ms", missingMs);
        s.put("collapse_count", collapseCount);
        s.put("alert_count", alertCount);
        s.put("interval_count", intervalCount);
        s.put("keep_rate", validMs == 0 ? null : (double) normalMs / validMs);
        s.put("events_per_hour", validMs == 0 ? null : collapseCount * 3_600_000.0 / validMs);
        s.put("mean_interval_ms", intervalCount == 0 ? null : (double) intervalSum / intervalCount);
        s.put("mean_recovery_ms", recoveryCount == 0 ? null : (double) recoverySum / recoveryCount);
        return s;
    }

    private static final class Episode {
        final long onset;
        final long onsetValid;
        final long firstAlert;
        final String type;
        long lastAlert;

        Episode(long onset, long onsetValid, long at, String type) {
            this.onset = onset;
            this.onsetValid = onsetValid;
            this.firstAlert = at;
            this.lastAlert = at;
            this.type = type;
        }
    }
}
