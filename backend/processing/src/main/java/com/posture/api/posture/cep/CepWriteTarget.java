package com.posture.api.posture.cep;

import java.util.List;

/**
 * (D-18) 판정 결과를 영구 저장소(MySQL)에 쓰는 대상.
 *
 * {@link CepWriteBuffer}가 모아 둔 쓰기를 한 번에(batch) 넘긴다. 구현체는 실패 시
 * 예외를 그대로 던진다 — 재시도·보관은 {@link CepWriteBuffer}가 맡는다.
 * 테스트에서는 이 인터페이스의 가짜 구현으로 DB 장애를 흉내 낸다.
 */
interface CepWriteTarget {

    /** sessions 테이블 upsert. 세션마다 이번 묶음에서 처음·마지막으로 본 시각과 샘플 수를 더한다. */
    void upsertSessions(List<SessionTouch> touches);

    /** collapse_events 테이블 upsert. (session_id, started_at) 기준 최신 상태로 덮어쓴다. */
    void upsertEvents(List<EventRow> rows);
}
