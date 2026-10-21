package com.posture.api.posture.cep;

import java.time.Instant;

/**
 * (D-18) collapse_events 한 행의 스냅샷.
 *
 * {@link CepOutcome}은 엔진 안의 가변 객체({@link CollapseEvent})를 가리키므로,
 * 나중에(다른 스레드에서) DB에 쓸 때 값이 바뀌어 있지 않도록 판정 직후 값을 복사해 둔다.
 */
record EventRow(
        String sessionId,
        String userId,
        Instant startedAt,
        Instant endedAt,
        Double durationSeconds,
        int alertCount,
        Instant lastAlertAt,
        boolean recovered,
        boolean ongoing) {

    static EventRow from(CepOutcome outcome) {
        return new EventRow(
                outcome.sessionId(),
                outcome.userId(),
                outcome.startedAt(),
                outcome.endedAt(),
                outcome.durationSeconds(),
                outcome.alertCount(),
                outcome.lastAlertAt(),
                outcome.recovered(),
                outcome.ongoing());
    }

    /** collapse_events의 UNIQUE(session_id, started_at)와 같은 키. */
    String key() {
        return sessionId + "|" + startedAt.toEpochMilli();
    }
}
