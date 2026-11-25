package org.posegood.api.realtime;

import java.time.Instant;
import java.util.UUID;

import org.posegood.api.contract.FrameInterval;
import org.posegood.api.session.FrameFeatures;
import org.posegood.api.session.SessionService;

/**
 * local 경로(기본): API 안에서 추론·판정·저장한다(ADR 0020). 지금까지 핸들러가 {@link SessionService}를 부르던
 * 것을 그대로 감쌌다 — 동작은 하나도 바뀌지 않는다.
 */
final class LocalPipeline implements MeasurementPipeline {
	private final SessionService sessions;

	LocalPipeline(SessionService sessions) {
		this.sessions = sessions;
	}

	@Override
	public SessionService.Realtime open(long owner, UUID sessionId) {
		return sessions.openRealtime(owner, sessionId);
	}

	@Override
	public Accepted frames(long owner, UUID sessionId, FrameInterval interval, FrameFeatures.Features baseline) {
		var status = sessions.frames(owner, sessionId, interval, baseline);
		return new Accepted(status.lastSequence(), status);
	}

	@Override
	public void finish(long owner, UUID sessionId, Long endMs) {
		sessions.finish(owner, sessionId, endMs);
	}

	@Override
	public boolean local() {
		return true;
	}

	/** 기존 local 자정 넘김 그대로 — 엔진이 이전 세션을 끝내 저장하고 새 세션을 만든다. */
	@Override
	public SessionService.Rollover rollover(long owner, UUID sessionId, Instant midnight, long limitMs) {
		return sessions.rollover(owner, sessionId, midnight, limitMs);
	}
}
