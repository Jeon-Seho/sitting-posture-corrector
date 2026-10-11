package org.posegood.api.realtime;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.util.UUID;

/**
 * 실시간 채널이 보내는 메시지 형식 모음: ack, observation, progress, decision, alert, stalled, closed.
 *
 * 계약: contracts/realtime/realtime-ws.v1.schema.json(전송 형식은 snake_case).
 */
final class RealtimeMessages {
    private RealtimeMessages() {}

    record Ack(String type, UUID sessionId, long lastSequence) {
        Ack(UUID sessionId, long lastSequence) {
            this("ack", sessionId, lastSequence);
        }
    }

    record ObservationPush(String type, UUID sessionId, Observation observation) {
        ObservationPush(UUID sessionId, Observation observation) {
            this("observation", sessionId, observation);
        }
    }

    record Progress(String type, UUID sessionId, long lastSequence, Summary summary) {
        Progress(UUID sessionId, long lastSequence, Summary summary) {
            this("progress", sessionId, lastSequence, summary);
        }
    }

    record Decision(String type, UUID sessionId, DecisionEvent event, Summary summary) {
        Decision(UUID sessionId, DecisionEvent event, Summary summary) {
            this("decision", sessionId, event, summary);
        }
    }

    record Alert(String type, UUID sessionId, long eventId, String kind, String deviationType) {
        Alert(UUID sessionId, DecisionEvent event) {
            this("alert", sessionId, event.eventId(), event.kind(), event.deviationType());
        }
    }

    record Stalled(String type, UUID sessionId, long sinceLastSequence) {
        Stalled(UUID sessionId, long sinceLastSequence) {
            this("stalled", sessionId, sinceLastSequence);
        }
    }

    /** 사유: ended, unauthorized, not_owner, session_lost, server_shutdown. */
    record Closed(String type, UUID sessionId, String reason) {
        Closed(UUID sessionId, String reason) {
            this("closed", sessionId, reason);
        }
    }
}
