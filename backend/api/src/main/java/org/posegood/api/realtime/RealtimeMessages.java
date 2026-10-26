package org.posegood.api.realtime;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

import java.time.Instant;
import java.util.UUID;

/**
 * 실시간 채널({@code /v2/realtime})이 보내는 메시지 형식 모음. 형식은 {@link V2}에 있다(전송 형식은 snake_case).
 */
final class RealtimeMessages {
    private RealtimeMessages() {}

    /**
     * {@code /v2/realtime} 메시지 형식. 연결 하나가 세션(또는 등록) 하나라 hello·ready만 ID를 담는다.
     *
     * 계약: contracts/realtime/realtime-ws.v2.schema.json. closed 사유: ended, unauthorized, not_owner, session_lost,
     * no_baseline, bad_message, server_shutdown, limit_reached.
     */
    static final class V2 {
        private V2() {}

        /** {@code startedAt}: 서버의 세션 시작 시각(S1을 받은 시각, UTC). 앱의 오늘 기록 시각·날짜 기준(ADR 0028). */
        record ReadyMeasure(String type, String purpose, UUID sessionId, Instant startedAt) {
            ReadyMeasure(UUID sessionId, Instant startedAt) {
                this("ready", "measure", sessionId, startedAt);
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

        /**
         * {@code endedAt}: 측정 세션이 이 연결에서 끝났으면 서버의 세션 종료 시각(DB {@code ended_at}과 같은 값, UTC).
         * 끝나기 전에 닫히거나 등록 연결이면 null(ADR 0028).
         */
        record Closed(String type, String reason, Instant endedAt) {
            Closed(String reason, Instant endedAt) {
                this("closed", reason, endedAt);
            }
        }
    }
}
