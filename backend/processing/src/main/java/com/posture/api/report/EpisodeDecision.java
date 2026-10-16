package com.posture.api.report;

import java.util.Map;
import java.util.Set;

/**
 * (D-30) {@code posture.episodes.v1}의 decision 메시지 하나 — 저장에 필요한 값만 꺼낸 것.
 *
 * <p>시각은 모두 세션 시작 기준 ms다(계약 v1). 절대 시각은 저장할 때 DB의 {@code monitor_session.started_at}에 더해 만든다.
 *
 * @param sessionId 봉투 {@code session_id} = {@code monitor_session.client_session_uuid}
 * @param eventId   계약 {@code event_id}(모든 사건 종류를 통틀어 1부터) — 로그·DLQ 추적용, DB 순번과는 다름
 * @param kind      collapse_confirmed · reminder · recovery_confirmed · interrupted · session_ended
 * @param timestampMs 사건 시각
 * @param onsetMs   붕괴 시작 시각(사건을 찾는 열쇠). session_ended는 timestamp와 같음
 * @param reason    interrupted·session_ended의 사유(그 밖은 null)
 * @param normalMs  요약 {@code normal_ms} — 세션 종료 때 {@code good_sec}
 */
public record EpisodeDecision(String sessionId, long eventId, String kind, long timestampMs, long onsetMs,
                              String reason, long normalMs) {

    static final Set<String> KINDS = Set.of(
            "collapse_confirmed", "reminder", "recovery_confirmed", "interrupted", "session_ended");

    /** 봉투째 받은 메시지에서 만든다. decision이 아니면 null. 형식이 틀리면 {@link IllegalArgumentException}. */
    @SuppressWarnings("unchecked")
    public static EpisodeDecision fromEnvelope(Map<String, Object> msg) {
        if (msg == null) {
            throw new IllegalArgumentException("빈 메시지");
        }
        if (!"1.0".equals(msg.get("schema_version")) || !(msg.get("session_id") instanceof String sid)
                || sid.length() != 36) {
            throw new IllegalArgumentException("봉투 형식 오류(schema_version 1.0·session_id UUID 필요)");
        }
        Object kind = msg.get("kind");
        if ("progress".equals(kind)) {
            return null;
        }
        if (!"decision".equals(kind)) {
            throw new IllegalArgumentException("모르는 kind: " + kind);
        }
        if (!(msg.get("body") instanceof Map<?, ?> body) || !(body.get("event") instanceof Map<?, ?> ev)) {
            throw new IllegalArgumentException("decision 본문에 event 없음");
        }
        Map<String, Object> event = (Map<String, Object>) ev;
        Map<String, Object> summary = body.get("summary") instanceof Map<?, ?> s ? (Map<String, Object>) s : Map.of();
        if (!(event.get("kind") instanceof String k) || !KINDS.contains(k)) {
            throw new IllegalArgumentException("모르는 사건 종류: " + event.get("kind"));
        }
        if (!sid.equals(event.get("session_id"))) {
            throw new IllegalArgumentException("봉투와 사건의 session_id가 다름");
        }
        long ts = nonNegative(event, "timestamp_ms");
        long onset = nonNegative(event, "onset_ms");
        long eventId = nonNegative(event, "event_id");
        long normal = summary.get("normal_ms") instanceof Number n ? Math.max(0, n.longValue()) : 0;
        if (!"session_ended".equals(k) && onset > ts) {
            throw new IllegalArgumentException("onset_ms > timestamp_ms");
        }
        String reason = event.get("reason") instanceof String r ? r : null;
        return new EpisodeDecision(sid, eventId, k, ts, onset, reason, normal);
    }

    private static long nonNegative(Map<String, Object> m, String key) {
        if (!(m.get(key) instanceof Number n) || n.longValue() < 0) {
            throw new IllegalArgumentException(key + " 없음 또는 음수");
        }
        return n.longValue();
    }
}
