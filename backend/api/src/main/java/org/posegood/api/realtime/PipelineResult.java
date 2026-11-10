package org.posegood.api.realtime;

import java.util.List;
import java.util.UUID;

/**
 * kafka 경로 결과 하나(D-57): 결과 토픽에서 받아 앱 메시지로 바꾼 것. {@link KafkaResults}가 내고 {@link RealtimeHandlerV2}가
 * 그 세션의 연결로 보낸다(연결이 이 서버에 없으면 버린다).
 *
 * @param messages 보낼 앱 메시지({@code RealtimeMessages.V2}), 순서대로
 * @param observedSequence 관측이면 그 구간 순번(지연 {@code stalled} 판단용), 아니면 null
 * @param endedTotalMs 세션 종료 사건이면 그 세션의 전체 시간(서버 종료 시각 = 시작 + 이 값), 아니면 null
 * @param unmeasurableEndMs 측정불가가 시간 한도만큼 이어졌으면 끝낼 자리(그 구간 끝), 아니면 null
 */
record PipelineResult(
	UUID sessionId,
	List<Object> messages,
	Long observedSequence,
	Long endedTotalMs,
	Long unmeasurableEndMs) {
}
