package org.posegood.api.realtime;

import java.time.Instant;
import java.util.UUID;

import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.contract.SessionView.Summary;

/**
 * 실시간 채널({@code /v2/realtime})이 보내는 메시지 형식 모음. 형식은 {@link V2}에 있다(전송 형식은 snake_case).
 */
final class RealtimeMessages {
	private RealtimeMessages() {
	}

	/**
	 * {@code /v2/realtime} 메시지 형식. 연결 하나가 세션(또는 등록) 하나라 hello·ready만 ID를 담는다.
	 *
	 * 계약: contracts/realtime/realtime-ws.v2.schema.json. closed 사유: ended, unauthorized, not_owner, session_lost,
	 * no_baseline, bad_message, server_shutdown, limit_reached, unmeasurable_timeout, day_changed.
	 * 자정 넘김({@code session_rollover})은 연결 안에서 세션을 바꾸므로 이전·새 세션 ID를 함께 담는다.
	 */
	static final class V2 {
		private V2() {
		}

		/** {@code startedAt}: 서버의 세션 시작 시각(S1을 받은 시각, UTC). 앱의 오늘 기록 시각·날짜 기준(ADR 0028). */
		record ReadyMeasure(String type, String purpose, UUID sessionId, Instant startedAt) {
			ReadyMeasure(UUID sessionId, Instant startedAt) {
				this("ready", "measure", sessionId, startedAt);
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

		/**
		 * 자정 넘김(BE-6 ① B안): 이전 세션이 끝났고 이 연결은 새 세션({@code sessionId}, 자정 {@code startedAt}에 시작)으로
		 * 이어진다. {@code atMs}는 새 세션이 시작하는 자리를 앱이 보내는 시간축(연결 기준)으로 적은 값이다.
		 */
		record SessionRollover(String type, Ended ended, UUID sessionId, Instant startedAt, long atMs) {
			SessionRollover(
				UUID previous, Instant endedAt, Summary summary, UUID sessionId, Instant startedAt, long atMs) {
				this("session_rollover", new Ended(previous, endedAt, summary), sessionId, startedAt, atMs);
			}
		}

		/** 자정 넘김으로 끝난 세션: ID, 서버 종료 시각(DB {@code ended_at}과 같은 값, UTC), 최종 요약. */
		record Ended(UUID sessionId, Instant endedAt, Summary summary) {
		}

		/**
		 * {@code endedAt}: 측정 세션이 이 연결에서 끝났으면 서버의 세션 종료 시각(DB {@code ended_at}과 같은 값, UTC).
		 * 끝나기 전에 닫히면 null(ADR 0028).
		 */
		record Closed(String type, String reason, Instant endedAt) {
			Closed(String reason, Instant endedAt) {
				this("closed", reason, endedAt);
			}
		}
	}
}
