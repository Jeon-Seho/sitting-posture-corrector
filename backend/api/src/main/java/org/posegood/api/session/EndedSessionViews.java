package org.posegood.api.session;

import java.util.UUID;

import org.posegood.api.contract.SessionView;

/**
 * 끝난 세션을 DB 행에서 다시 만든 세션 결과(S4가 메모리에 끝난 결과가 없을 때 씀, BE-11).
 *
 * 구현은 기록 목록(R1)과 같은 재계산을 쓰는 {@code workspace} 쪽에 있다. {@code workspace}가 이 패키지를 쓰므로
 * 반대 방향은 이 인터페이스로만 잇는다.
 */
public interface EndedSessionViews {
	/** 내 세션이고 DB에 끝난 값({@code ended_at})이 있으면 그 결과, 아니면 null(종료 저장이 실패한 세션도 null). */
	SessionView find(long owner, UUID id);
}
