package org.posegood.api.contract;

import java.util.List;
import java.util.UUID;

/**
 * 세션 조회 응답: 정책, 요약 통계, 판정 사건 목록.
 *
 * 계약: contracts/session-view.v1.schema.json.
 */
public record SessionView(
        String schemaVersion,
        UUID sessionId,
        Policy policy,
        String timerPolicy,
        boolean ended,
        long lastSequence,
        Summary summary,
        List<DecisionEvent> events) {

    public static final String TIMER_POLICY = "legacy-interrupt-v1";

    /**
     * 판정 사건 하나: 붕괴 확정, 재알림, 회복, 중단, 세션 종료.
     *
     * 계약: contracts/posture-event.v1.schema.json.
     */
    public record DecisionEvent(
            String schemaVersion,
            UUID sessionId,
            long eventId,
            String kind,
            long timestampMs,
            long onsetMs,
            long onsetValidMs,
            String deviationType,
            String reason) {}

    /**
     * 세션 요약: 시간 합계(전체·유효·바른·이탈·휴식·자리 비움·판정 불가·누락)와 통계.
     *
     * 필드 순서는 스키마와 같다. 비율이 null이면 계산할 수 없다는 뜻이다.
     */
    public record Summary(
            long totalMs,
            long validMs,
            long normalMs,
            long deviationMs,
            long restMs,
            long awayMs,
            long unknownMs,
            long missingMs,
            long collapseCount,
            long alertCount,
            long intervalCount,
            Double keepRate,
            Double eventsPerHour,
            Double meanIntervalMs,
            Double meanRecoveryMs) {}
}
