package com.posture.api.posture.judge;

import java.util.Optional;

/**
 * (D-105) 판정기를 정책 없이 만들어야 할 때 — {@code session_started}보다 관측이 먼저 왔거나, 재시작 뒤 판정 상태를
 * 복원하지 못했을 때 — 그 세션의 정책을 서비스 DB에서 찾는다({@code monitor_session.threshold_policy_id}
 * → {@code threshold_policy}). 세션 행은 입출구 서버가 측정 시작(S1) 때 이미 만든다.
 */
public interface SessionPolicyLookup {

	/** 정책을 찾지 못하면 빈 값. DB 오류는 예외로 던진다(호출 쪽이 기본 정책으로 판정을 이어 간다). */
	Optional<JudgePolicy> find(String sessionId);

	/** DB를 쓰지 않는 시험용 — 늘 빈 값. */
	SessionPolicyLookup NONE = sessionId -> Optional.empty();
}
