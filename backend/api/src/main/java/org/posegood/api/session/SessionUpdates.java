package org.posegood.api.session;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.Summary;
import org.posegood.api.engine.SessionEngine;

import java.util.List;
import java.util.UUID;

/**
 * 세션 변경 이벤트(실시간 채널로 전달된다).
 *
 * 세션 잠금을 잡은 채 동기로 발행하므로 실시간 채널은 한 세션의 변경을 순서대로 받는다.
 */
public final class SessionUpdates {
    private SessionUpdates() {}

    /**
     * 새 관측·사건·요약.
     *
     * {@code live}가 null이면 종료만으로 사건이 생긴 경우다. 있으면 판정 엔진이 모은 묶음 하나(계획 0084)를 판정한 결과이고,
     * v2 채널은 관측 4.0 → 사건 → {@code progress}를 보낸다. {@code closedReason}은 서버가 스스로 끝냈을 때의 closed
     * 사유(측정불가 시간 초과면 {@code unmeasurable_timeout}, 자정 넘김이면 {@code day_changed})이고, 그 밖에는 null이다.
     * {@code day_changed}면 실시간 채널은 닫지 않고 새 세션으로 잇는다.
     */
    public record Progressed(
            UUID sessionId,
            List<SessionEngine.Decided> decided,
            long lastSequence,
            Summary summary,
            boolean ended,
            Observation.V4 live,
            String pausedReason,
            String closedReason) {}

    /**
     * 추론이 실패했거나 결과가 {@code posegood.inference.result-timeout} 안에 오지 않아 그 구간을 버렸다, 또는 스스로 한
     * 판정의 DB 기록이 일시 장애였다. 실시간 채널은 {@code stalled}를 보낸다.
     *
     * 버린 구간은 다시 판정하지 않아 그 시간은 누락이 된다.
     */
    public record Stalled(UUID sessionId) {}

    /**
     * 세션이 메모리에서 빠짐.
     *
     * {@code reason}은 실시간 closed 메시지의 사유다.
     */
    public record Removed(UUID sessionId, String reason) {}
}
