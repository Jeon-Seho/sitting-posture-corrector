package org.posegood.api.session;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.posegood.api.contract.SessionView;

/**
 * 판정을 다른 서비스가 하는 경로(kafka, D-57)에서 입출구 서버가 받아 둔 세션의 마지막 결과. 세션 조회(S4)가 메모리 값으로 쓴다.
 *
 * <p>local 경로는 판정 엔진이 이 서버에 있으므로 쓰지 않는다({@link #NONE}).
 */
public interface SessionResults {
	/** 받아 둔 결과가 없다(local 경로). */
	SessionResults NONE = sessionId -> Optional.empty();

	/** 그 세션의 마지막 결과. 받은 결과가 없거나 잊었으면 비어 있다. */
	Optional<Snapshot> latest(UUID sessionId);

	/**
	 * 마지막으로 받은 {@code progress}·{@code decision}의 값.
	 *
	 * @param lastSequence 결과로 받은 마지막 구간 순번(없으면 -1)
	 * @param summary 마지막 요약
	 * @param events 받은 판정 사건(사건 번호 순, 중복 없음)
	 * @param ended 종료 사건과 저장 완료를 다 받았다 — 이때만 {@code summary}가 최종 값이다
	 */
	record Snapshot(long lastSequence, SessionView.Summary summary, List<SessionView.DecisionEvent> events,
		boolean ended) {
		public Snapshot {
			events = List.copyOf(events);
		}
	}
}
