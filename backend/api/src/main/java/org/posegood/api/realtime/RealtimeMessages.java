package org.posegood.api.realtime;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.time.Instant;
import java.util.UUID;

/**
 * 실시간 채널이 보내는 메시지 형식 모음: ack, observation, progress, decision, alert, stalled, closed.
 *
 * 계약: contracts/realtime/realtime-ws.v1.schema.json(전송 형식은 snake_case). v2 형식(ready·calibration_result 추가,
 * progress.paused_reason, 세션 ID 없음)은 {@link V2}에 있다.
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

    /**
     * {@code /v2/realtime} 메시지 형식. 연결 하나가 세션(또는 등록) 하나라 hello·ready만 ID를 담는다.
     *
     * 계약: contracts/realtime/realtime-ws.v2.schema.json. closed 사유: ended, unauthorized, not_owner, session_lost,
     * no_baseline, bad_message, server_shutdown, limit_reached.
     */
    static final class V2 {
        private V2() {}

        record ReadyMeasure(String type, String purpose, UUID sessionId) {
            ReadyMeasure(UUID sessionId) {
                this("ready", "measure", sessionId);
            }
        }

        record ReadyCalibration(String type, String purpose, UUID calibrationId) {
            ReadyCalibration(UUID calibrationId) {
                this("ready", "calibration", calibrationId);
            }
        }

        record Ack(String type, long lastSequence) {
            Ack(long lastSequence) {
                this("ack", lastSequence);
            }
        }

        record ObservationPush(String type, Observation.V3 observation) {
            ObservationPush(Observation.V3 observation) {
                this("observation", observation);
            }
        }

        record Progress(String type, long lastSequence, Summary summary, String pausedReason) {
            Progress(long lastSequence, Summary summary, String pausedReason) {
                this("progress", lastSequence, summary, pausedReason);
            }
        }

        /** 판정 사건(세션 ID·스키마 버전 없이). */
        record Event(
                long eventId,
                String kind,
                long timestampMs,
                long onsetMs,
                long onsetValidMs,
                String deviationType,
                String reason) {
            Event(DecisionEvent event) {
                this(
                        event.eventId(),
                        event.kind(),
                        event.timestampMs(),
                        event.onsetMs(),
                        event.onsetValidMs(),
                        event.deviationType(),
                        event.reason());
            }
        }

        record Decision(String type, Event event, Summary summary) {
            Decision(DecisionEvent event, Summary summary) {
                this("decision", new Event(event), summary);
            }
        }

        record Alert(String type, long eventId, String kind, String deviationType) {
            Alert(DecisionEvent event) {
                this("alert", event.eventId(), event.kind(), event.deviationType());
            }
        }

        record Stalled(String type, long sinceLastSequence) {
            Stalled(long sinceLastSequence) {
                this("stalled", sinceLastSequence);
            }
        }

        record CalibrationOk(
                String type,
                String status,
                UUID calibrationId,
                UUID baselineId,
                Instant registeredAt,
                SessionRequests.Landmarks landmarks,
                int validFrames) {
            CalibrationOk(
                    UUID calibrationId,
                    UUID baselineId,
                    Instant registeredAt,
                    SessionRequests.Landmarks landmarks,
                    int validFrames) {
                this("calibration_result", "ok", calibrationId, baselineId, registeredAt, landmarks, validFrames);
            }
        }

        /** 실패 사유: too_few_frames, incomplete, out_of_frame, server_error. */
        record CalibrationFailed(String type, String status, UUID calibrationId, int validFrames, String reason) {
            CalibrationFailed(UUID calibrationId, int validFrames, String reason) {
                this("calibration_result", "failed", calibrationId, validFrames, reason);
            }
        }

        record Closed(String type, String reason) {
            Closed(String reason) {
                this("closed", reason);
            }
        }
    }
}
