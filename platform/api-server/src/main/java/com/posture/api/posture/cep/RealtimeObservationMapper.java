package com.posture.api.posture.cep;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * (D-21) 실시간 계약 v1 {@code posture.inference.v1} 메시지를 판정 엔진 입력({@link InferenceEvent})으로 바꾼다.
 *
 * <ul>
 *   <li>{@code session_started}: 세션 시작 시각(봉투 {@code produced_at})을 기억한다.</li>
 *   <li>{@code observation}: 판정 시각 = 세션 시작 시각 + 구간 {@code end_ms}(이벤트 시각 기준 — 재생과 실제 입력이
 *       같은 결과를 낸다). 상태 = 측정 중({@code running})이 아니거나 {@code valid=false}면 UNKNOWN,
 *       점수 ≥ 기준값이면 BAD, 아니면 NORMAL.</li>
 *   <li>{@code session_ended}: 기억한 시작 시각을 지운다. (즉시 최종 요약은 D-23)</li>
 * </ul>
 *
 * <p>시작 메시지를 못 받은 세션(재시작 직후 등)은 첫 관측의 {@code produced_at - end_ms}를 시작 시각으로 삼는다
 * (추론 처리 지연만큼 수십 ms 어긋날 수 있음). 기억하는 세션 수는 {@code capacity}로 제한한다(오래된 것부터 버림).
 *
 * <p>판정 정책({@code policy})·판정 불가 시 시계 멈춤·{@code rest} 처리·{@code sequence} 중복 무시는 D-23 범위다.
 * 지금은 기존 엔진 동작(UNKNOWN = 정상 쪽)을 그대로 쓴다.
 */
public final class RealtimeObservationMapper {

    private static final Logger log = LoggerFactory.getLogger(RealtimeObservationMapper.class);

    public enum Kind { SESSION_STARTED, OBSERVATION, SESSION_ENDED, IGNORED }

    /** 변환 결과. {@code event}는 OBSERVATION일 때만 있다. */
    public record Result(Kind kind, String sessionId, Optional<InferenceEvent> event, String reason) {
        static Result of(Kind kind, String sessionId) {
            return new Result(kind, sessionId, Optional.empty(), null);
        }

        static Result ignored(String sessionId, String reason) {
            return new Result(Kind.IGNORED, sessionId, Optional.empty(), reason);
        }
    }

    private final double collapseThreshold;
    private final Map<String, Instant> sessionStarts;

    public RealtimeObservationMapper(double collapseThreshold, int capacity) {
        this.collapseThreshold = collapseThreshold;
        int cap = Math.max(1, capacity);
        this.sessionStarts = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Instant> eldest) {
                return size() > cap;
            }
        };
    }

    public Result map(Map<String, Object> msg) {
        String sessionId = str(msg.get("session_id"));
        String userId = str(msg.get("user_id"));
        String kind = str(msg.get("kind"));
        if (sessionId == null || sessionId.isBlank()) {
            return Result.ignored(null, "session_id 없음");
        }
        Instant producedAt = instant(msg.get("produced_at"));
        Map<String, Object> body = msg.get("body") instanceof Map<?, ?> b ? cast(b) : null;
        if (kind == null || body == null) {
            return Result.ignored(sessionId, "kind 또는 body 없음");
        }

        switch (kind) {
            case "session_started" -> {
                if (producedAt == null) {
                    return Result.ignored(sessionId, "session_started의 produced_at을 읽을 수 없음");
                }
                synchronized (sessionStarts) {
                    sessionStarts.put(sessionId, producedAt);
                }
                return Result.of(Kind.SESSION_STARTED, sessionId);
            }
            case "session_ended" -> {
                synchronized (sessionStarts) {
                    sessionStarts.remove(sessionId);
                }
                return Result.of(Kind.SESSION_ENDED, sessionId);
            }
            case "observation" -> {
                return observation(sessionId, userId, producedAt, body);
            }
            default -> {
                return Result.ignored(sessionId, "모르는 kind: " + kind);
            }
        }
    }

    private Result observation(String sessionId, String userId, Instant producedAt, Map<String, Object> body) {
        Long endMs = body.get("end_ms") instanceof Number n ? n.longValue() : null;
        if (endMs == null || endMs < 0) {
            return Result.ignored(sessionId, "end_ms 없음");
        }
        Instant start;
        synchronized (sessionStarts) {
            start = sessionStarts.get(sessionId);
            if (start == null) {
                if (producedAt == null) {
                    return Result.ignored(sessionId, "세션 시작 시각과 produced_at이 모두 없음");
                }
                start = producedAt.minusMillis(endMs);
                sessionStarts.put(sessionId, start);
                log.info("세션 시작 메시지 없이 관측을 받음 — 시작 시각을 produced_at - end_ms로 추정 (sessionId={})",
                        sessionId);
            }
        }
        String status = status(body);
        InferenceEvent event = new InferenceEvent(sessionId, userId, status, start.plusMillis(endMs).toString());
        return new Result(Kind.OBSERVATION, sessionId, Optional.of(event), null);
    }

    String status(Map<String, Object> body) {
        boolean running = "running".equals(body.get("phase"));
        boolean valid = Boolean.TRUE.equals(body.get("valid"));
        if (!running || !valid) {
            return PostureCepEngine.UNKNOWN_STATUS;
        }
        double score = body.get("collapse_probability") instanceof Number n ? n.doubleValue() : 0.0;
        return score >= collapseThreshold ? "BAD" : PostureCepEngine.NORMAL_STATUS;
    }

    int trackedSessions() {
        synchronized (sessionStarts) {
            return sessionStarts.size();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cast(Map<?, ?> m) {
        return (Map<String, Object>) m;
    }

    private static String str(Object v) {
        return v != null ? v.toString() : null;
    }

    private static Instant instant(Object v) {
        if (!(v instanceof String s)) {
            return null;
        }
        try {
            return Instant.parse(s);
        } catch (DateTimeParseException exc) {
            return null;
        }
    }
}
