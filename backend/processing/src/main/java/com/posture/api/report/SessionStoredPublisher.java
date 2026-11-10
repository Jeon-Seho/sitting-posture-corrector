package com.posture.api.report;

/**
 * (D-67) 세션 종료 값 저장이 끝났음을 {@code posture.stored.v1}로 알린다. 판정 결과 저장이 {@code session_ended}를 DB에
 * 쓴 뒤에 부른다({@link EpisodeStoreService}). 입출구 서버 {@code ws}는 이것을 받은 뒤에야 앱에
 * {@code decision(session_ended)} → {@code closed(ended)}를 보낸다(2026-10-26 결정 ②: 정상 종료는 최종 결과 저장 뒤).
 */
public interface SessionStoredPublisher {

	/** 시험·끔 설정용: 아무것도 보내지 않는다. */
	SessionStoredPublisher NO_OP = d -> {
	};

	/** @param decision 저장을 끝낸 session_ended decision */
	void publish(EpisodeDecision decision);
}
