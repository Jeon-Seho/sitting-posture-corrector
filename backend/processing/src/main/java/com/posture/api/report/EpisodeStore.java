package com.posture.api.report;

import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * (D-30, D-51) 확정 서비스 DB(V2.3 {@code posture_service})의 결과 테이블 접근. 시각 인자는 모두 세션 시작 기준 ms이고,
 * 절대 시각은 구현이 DB 안에서 {@code monitor_session.started_at}에 더해 만든다(시간대 변환을 한 곳에서만 하도록).
 *
 * <p>V2.3: 종료 사유 컬럼이 없다(세션·이벤트 모두 — 이벤트 종료 사유는 시각으로 판정). 알림 행은
 * ({@code monitor_session_id}, {@code event_seq}, {@code attempted_at})가 PK이고 시도 순번·표시 여부·억제 사유가 없다.
 *
 * <p>DB 오류는 {@code org.springframework.dao.DataAccessException}으로 그대로 던진다. 제약 위반
 * ({@code DataIntegrityViolationException})은 메시지 문제, 그 밖은 DB 장애로 본다({@link EpisodeStoreService}).
 */
public interface EpisodeStore {

    Optional<SessionRow> findSession(String clientSessionUuid);

    /** 같은 세션에서 시작 시각이 같은 붕괴 이벤트의 순번. */
    OptionalInt eventSeqByStart(long sessionId, long startedMs);

    int maxEventSeq(long sessionId);

    void insertEvent(long sessionId, int eventSeq, long startedMs, long confirmedMs);

    /**
     * 진행 중인 이벤트를 닫는다. 종료 시각이 확정 시각보다 앞이면 확정 시각으로. 회복이면 {@code recovered_at}도 같은 시각.
     * @return 닫았으면 true(이미 닫혔으면 false)
     */
    boolean endEvent(long sessionId, int eventSeq, long endedMs, boolean recovered);

    /** 세션의 진행 중 이벤트를 모두 닫는다(세션 종료 시각). @return 닫은 수 */
    int endOpenEvents(long sessionId, long endedMs);

    /** 같은 이벤트·같은 시각의 알림 행이 있는지(PK). */
    boolean alertExists(long sessionId, int eventSeq, long attemptedMs);

    void insertAlert(long sessionId, int eventSeq, long attemptedMs);

    /** 종료 값 2개({@code ended_at}·{@code good_sec})를 함께 채운다(이미 있으면 그대로). @return 채웠으면 true */
    boolean endSession(long sessionId, long endedMs, long goodMs);

    /**
     * (D-39) 제외 구간을 연다(종료 시각 NULL = 진행 중). 같은 시작 시각의 행(PK)이 있으면 그대로 둔다.
     * @param reason {@code excluded_interval.exclusion_reason} 값(PAUSE·ABSENCE·UNMEASURABLE·MISSING)
     * @return 새로 넣었으면 true
     */
    boolean startExcluded(long sessionId, long startedMs, String reason);

    /**
     * (D-39) 제외 구간을 닫는다. 열린 행이 있으면 종료 시각을 채우고, 행이 없으면(시작 메시지 유실) 시작·끝을 함께 넣는다.
     * 이미 닫혀 있으면 그대로 둔다.
     * @return 바꿨으면 true
     */
    boolean endExcluded(long sessionId, long startedMs, long endedMs, String reason);

    /** (D-39) 세션 종료 때 아직 열린 제외 구간을 종료 시각으로 닫는다. @return 닫은 수 */
    int endOpenExcluded(long sessionId, long endedMs);

    /** 확인용: 세션·이벤트·알림·제외 구간을 세션 시작 기준 ms로 읽는다. */
    Optional<Map<String, Object>> sessionView(String clientSessionUuid);
}
