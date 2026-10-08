package com.posture.api.posture.cep;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * posture-cep(Python, {@code app/db.py})이 {@code sessions}/{@code collapse_events}
 * 테이블에 쓰던 upsert 로직을 옮긴 것(D-13).
 *
 * <p>(D-18) 판정 경로(Kafka 컨슈머 스레드)는 이제 이 클래스를 직접 부르지 않는다.
 * {@link CepWriteBuffer}가 모아 둔 쓰기를 별도 스레드에서 묶음(batch)으로 넘기며,
 * 실패하면 예외를 그대로 던져 버퍼가 보관·재시도하게 한다.
 */
@Repository
public class CepJdbcRepository implements CepWriteTarget {

    private static final Logger log = LoggerFactory.getLogger(CepJdbcRepository.class);

    /*
     * (D-18) 세션별로 합친 샘플을 한 번에 쓴다. 이미 있는 행이면
     * last_seen_at은 더 늦은 값으로, sample_count는 이번 묶음의 샘플 수만큼 더한다.
     * (보관 후 재시도로 순서가 바뀌어도 last_seen_at이 거꾸로 가지 않게 GREATEST 사용)
     */
    private static final String SESSION_UPSERT_SQL = """
            INSERT INTO sessions
                (session_id, user_id, started_at, last_seen_at, sample_count, status)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE')
            ON DUPLICATE KEY UPDATE
                last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at)),
                sample_count = sample_count + VALUES(sample_count)
            """;

    private static final String COLLAPSE_EVENT_UPSERT_SQL = """
            INSERT INTO collapse_events
                (session_id, user_id, started_at, ended_at, duration_seconds,
                 alert_count, last_alert_at, recovered, ongoing)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                ended_at = VALUES(ended_at),
                duration_seconds = VALUES(duration_seconds),
                alert_count = VALUES(alert_count),
                last_alert_at = VALUES(last_alert_at),
                recovered = VALUES(recovered),
                ongoing = VALUES(ongoing)
            """;

    private static final String EXPIRE_SESSIONS_SQL = """
            UPDATE sessions
            SET status = 'ENDED'
            WHERE status = 'ACTIVE'
              AND last_seen_at < ?
            """;

    private final JdbcTemplate jdbcTemplate;

    public CepJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void upsertSessions(List<SessionTouch> touches) {
        if (touches.isEmpty()) {
            return;
        }
        List<Object[]> args = new ArrayList<>(touches.size());
        for (SessionTouch t : touches) {
            args.add(new Object[] {
                    t.sessionId(), t.userId(),
                    Timestamp.from(t.firstSeen()), Timestamp.from(t.lastSeen()), t.samples()});
        }
        jdbcTemplate.batchUpdate(SESSION_UPSERT_SQL, args);
    }

    @Override
    public void upsertEvents(List<EventRow> rows) {
        if (rows.isEmpty()) {
            return;
        }
        List<Object[]> args = new ArrayList<>(rows.size());
        for (EventRow r : rows) {
            args.add(new Object[] {
                    r.sessionId(),
                    r.userId(),
                    Timestamp.from(r.startedAt()),
                    r.endedAt() != null ? Timestamp.from(r.endedAt()) : null,
                    r.durationSeconds(),
                    r.alertCount(),
                    r.lastAlertAt() != null ? Timestamp.from(r.lastAlertAt()) : null,
                    r.recovered() ? 1 : 0,
                    r.ongoing() ? 1 : 0});
        }
        jdbcTemplate.batchUpdate(COLLAPSE_EVENT_UPSERT_SQL, args);
    }

    /**
     * {@code last_seen_at}이 {@code timeoutSeconds}초 이상 갱신되지 않은
     * ACTIVE 세션을 한 번에 ENDED로 마킹한다 (D-10). 세션 만료 스케줄러 스레드에서만
     * 부르며 판정 경로와는 무관하다.
     *
     * <p>(D-20) 기준 시각은 DB 함수({@code UTC_TIMESTAMP()}/{@code NOW()})가 아니라
     * 서버가 계산한 값({@code now - timeoutSeconds})을 바인딩한다. {@code last_seen_at}을 쓸 때와
     * 똑같이 {@code Timestamp.from(Instant)} → JDBC 접속 시간대(Asia/Seoul) 변환을 거치므로,
     * 저장 값과 비교 값이 항상 같은 기준(KST)이 된다. DB 서버의 {@code time_zone}이나
     * 컨테이너 시간대가 바뀌어도 결과가 달라지지 않는다. (이전에는 KST로 저장된 값을
     * {@code UTC_TIMESTAMP()}와 비교해 세션이 9시간 늦게 만료됐다.)
     *
     * @param now            기준 시각 (메모리 엔진 만료와 같은 값을 넘긴다)
     * @param timeoutSeconds 무응답 허용 시간(초)
     * @return 이번 호출로 ENDED로 바뀐 행 수. 실패 시 0을 반환하고 예외를 던지지 않는다.
     */
    public int expireStaleSessions(Instant now, long timeoutSeconds) {
        try {
            return jdbcTemplate.update(EXPIRE_SESSIONS_SQL, expiryCutoff(now, timeoutSeconds));
        } catch (Exception exc) {
            log.warn("세션 만료 처리(sessions UPDATE) 실패: {}", exc.getMessage());
            return 0;
        }
    }

    /** (D-20) 만료 기준 시각: {@code now}에서 {@code timeoutSeconds}를 뺀 값. */
    static Timestamp expiryCutoff(Instant now, long timeoutSeconds) {
        return Timestamp.from(now.minusSeconds(timeoutSeconds));
    }
}
