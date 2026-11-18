package org.posegood.api.realtime;

import java.util.UUID;

import org.posegood.api.contract.FrameInterval;
import org.posegood.api.session.FrameFeatures;
import org.posegood.api.session.SessionService;

/**
 * 실시간 v2 측정의 뒤쪽: 받은 좌표 구간을 어디서 판정하는지(계획 0031, D-57).
 *
 * <p>{@link RealtimeHandlerV2}의 앞쪽(앱과의 약속 — hello·토큰·순서·closed 사유)은 그대로 두고 이 인터페이스만 부른다.
 * {@code local}(기본)은 지금처럼 API 안에서 추론·판정·저장하고({@link LocalPipeline}), {@code kafka}는 Kafka로 보내고
 * 처리 서비스의 결과 토픽을 받아 앱에 보낸다. 판정 규칙은 어느 쪽에서도 이 인터페이스 밖에 있다.
 */
interface MeasurementPipeline {
	/** hello 수락: 내 세션인지·진행 중인지·기준 자세가 있는지 확인한다. 거절은 {@code ApiError}. */
	SessionService.Realtime open(long owner, UUID sessionId);

	/**
	 * 구간 하나. 반환하면 그 순번까지 받았다는 뜻이다({@code ack} — 입력 접수, 2026-10-26).
	 *
	 * {@code progress}는 처리 직후 진행 상황을 바로 알 때만(local) 있고, 아니면 null이다(결과 토픽에서 따로 온다).
	 */
	Accepted frames(long owner, UUID sessionId, FrameInterval interval, FrameFeatures.Features baseline);

	/** 종료. {@code endMs}가 null이면 연결이 끊긴 것(마지막으로 받은 구간 끝, ADR 0024). */
	void finish(long owner, UUID sessionId, Long endMs);

	/**
	 * 결과(관측·사건·종료)가 API 안 판정의 세션 이벤트({@code SessionUpdates})로 오는지. true면 자정 넘김과
	 * 사건에서 알림 만들기를 핸들러가 한다. false(kafka)면 둘 다 하지 않는다(알림은 처리 서비스가 거른 것을 받는다).
	 */
	boolean local();

	/** 받은 마지막 순번(세션 기준)과, 있으면 처리 직후의 진행 상황. */
	record Accepted(long lastSequence, SessionService.Status progress) {
	}
}
