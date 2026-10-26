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
     * {@code observation}이 null이면 종료만으로 사건이 생긴 경우다. v2 채널은 관측 3.0({@code live})과
     * {@code pausedReason}을 보낸다. {@code closedReason}은 서버가 스스로 끝냈을 때의 closed 사유
     * (측정불가 시간 초과면 {@code unmeasurable_timeout})이고, 그 밖에는 null이다.
     */
    public record Progressed(
            UUID sessionId,
            Observation observation,
            List<SessionEngine.Decided> decided,
            long lastSequence,
            Summary summary,
            boolean ended,
            Observation.V3 live,
            String pausedReason,
            String closedReason) {}

    /**
     * 세션이 메모리에서 빠짐.
     *
     * {@code reason}은 실시간 closed 메시지의 사유다.
     */
    public record Removed(UUID sessionId, String reason) {}
}
