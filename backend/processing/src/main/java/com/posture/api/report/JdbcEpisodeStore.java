package com.posture.api.report;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.regex.Pattern;

/**
 * (D-30, D-51) {@link EpisodeStore}의 JDBC 구현(DB V2.3) — 기존 연결 풀로 같은 MySQL 서버의 {@code posture_service}를 스키마 이름을 붙여 쓴다(D-32).
 *
 * <p>절대 시각은 SQL 안에서 {@code DATE_ADD(monitor_session.started_at, INTERVAL <ms×1000> MICROSECOND)}로 만든다.
 * 세션 시작 시각과 같은 컬럼·같은 정밀도(DATETIME(3))에서 계산하므로 JVM·JDBC 시간대 변환을 거치지 않고,
 * 같은 메시지는 늘 같은 시각이 되어 시각으로 기존 행을 찾을 수 있다(순번 결정, C-3).
 */
@Component
public class JdbcEpisodeStore implements EpisodeStore {

    private static final Pattern SCHEMA_NAME = Pattern.compile("[A-Za-z0-9_]{1,64}");

    private final JdbcTemplate jdbc;
    private final String ms;   // `schema`.monitor_session
    private final String ce;
    private final String ca;

    public JdbcEpisodeStore(JdbcTemplate jdbc, @Value("${service-db.schema:posture_service}") String schema) {
        if (schema == null || !SCHEMA_NAME.matcher(schema).matches()) {
            throw new IllegalArgumentException("service-db.schema가 올바르지 않음: " + schema);
        }
        this.jdbc = jdbc;
        this.ms = "`" + schema + "`.monitor_session";
        this.ce = "`" + schema + "`.collapse_event";
        this.ca = "`" + schema + "`.correction_alert";
    }

    static long micros(long ms) {
        return ms * 1000L;
    }

    @Override
    public Optional<SessionRow> findSession(String clientSessionUuid) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT monitor_session_id AS id, alert_enabled, (ended_at IS NOT NULL) AS ended"
                        + " FROM " + ms + " WHERE client_session_uuid = ?", clientSessionUuid);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> r = rows.get(0);
        return Optional.of(new SessionRow(num(r.get("id")), bool(r.get("alert_enabled")), bool(r.get("ended"))));
    }

    @Override
    public OptionalInt eventSeqByStart(long sessionId, long startedMs) {
        return firstInt(jdbc.queryForList(
                "SELECT e.event_seq FROM " + ce + " e JOIN " + ms + " s ON s.monitor_session_id = e.monitor_session_id"
                        + " WHERE e.monitor_session_id = ? AND e.started_at = DATE_ADD(s.started_at, INTERVAL ? MICROSECOND)",
                Long.class, sessionId, micros(startedMs)));
    }

    @Override
    public int maxEventSeq(long sessionId) {
        return firstInt(jdbc.queryForList(
                "SELECT COALESCE(MAX(event_seq), 0) FROM " + ce + " WHERE monitor_session_id = ?",
                Long.class, sessionId)).orElse(0);
    }

    @Override
    public void insertEvent(long sessionId, int eventSeq, long startedMs, long confirmedMs) {
        jdbc.update("INSERT INTO " + ce + " (monitor_session_id, event_seq, started_at, confirmed_at)"
                        + " SELECT monitor_session_id, ?, DATE_ADD(started_at, INTERVAL ? MICROSECOND),"
                        + " DATE_ADD(started_at, INTERVAL ? MICROSECOND) FROM " + ms + " WHERE monitor_session_id = ?",
                eventSeq, micros(startedMs), micros(Math.max(startedMs, confirmedMs)), sessionId);
    }

    @Override
    public boolean endEvent(long sessionId, int eventSeq, long endedMs, boolean recovered) {
        String end = "GREATEST(DATE_ADD(s.started_at, INTERVAL ? MICROSECOND), e.confirmed_at)";
        String sql = "UPDATE " + ce + " e JOIN " + ms + " s ON s.monitor_session_id = e.monitor_session_id"
                + " SET e.ended_at = " + end
                + (recovered ? ", e.recovered_at = " + end : "")
                + " WHERE e.monitor_session_id = ? AND e.event_seq = ? AND e.ended_at IS NULL";
        int n = recovered
                ? jdbc.update(sql, micros(endedMs), micros(endedMs), sessionId, eventSeq)
                : jdbc.update(sql, micros(endedMs), sessionId, eventSeq);
        return n > 0;
    }

    @Override
    public int endOpenEvents(long sessionId, long endedMs) {
        return jdbc.update("UPDATE " + ce + " e JOIN " + ms + " s ON s.monitor_session_id = e.monitor_session_id"
                        + " SET e.ended_at = GREATEST(DATE_ADD(s.started_at, INTERVAL ? MICROSECOND), e.confirmed_at)"
                        + " WHERE e.monitor_session_id = ? AND e.ended_at IS NULL",
                micros(endedMs), sessionId);
    }

    @Override
    public boolean alertExists(long sessionId, int eventSeq, long attemptedMs) {
        return firstInt(jdbc.queryForList(
                "SELECT COUNT(*) FROM " + ca + " a JOIN " + ms + " s ON s.monitor_session_id = a.monitor_session_id"
                        + " WHERE a.monitor_session_id = ? AND a.event_seq = ?"
                        + " AND a.attempted_at = DATE_ADD(s.started_at, INTERVAL ? MICROSECOND)",
                Long.class, sessionId, eventSeq, micros(attemptedMs))).orElse(0) > 0;
    }

    @Override
    public void insertAlert(long sessionId, int eventSeq, long attemptedMs) {
        jdbc.update("INSERT INTO " + ca + " (monitor_session_id, event_seq, attempted_at)"
                        + " SELECT monitor_session_id, ?, DATE_ADD(started_at, INTERVAL ? MICROSECOND)"
                        + " FROM " + ms + " WHERE monitor_session_id = ?",
                eventSeq, micros(attemptedMs), sessionId);
    }

    @Override
    public boolean endSession(long sessionId, long endedMs, long goodMs) {
        BigDecimal goodSec = BigDecimal.valueOf(goodMs).divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP);
        return jdbc.update("UPDATE " + ms + " SET ended_at = DATE_ADD(started_at, INTERVAL ? MICROSECOND),"
                        + " good_sec = ? WHERE monitor_session_id = ? AND ended_at IS NULL",
                micros(endedMs), goodSec, sessionId) > 0;
    }

    @Override
    public Optional<Map<String, Object>> sessionView(String clientSessionUuid) {
        String off = "TIMESTAMPDIFF(MICROSECOND, s.started_at, %s) DIV 1000";
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT s.monitor_session_id, s.client_session_uuid, s.user_account_id, s.baseline_posture_id,"
                        + " s.threshold_policy_id, s.alert_enabled,"
                        + " DATE_FORMAT(s.started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at,"
                        + " " + String.format(off, "s.ended_at") + " AS ended_ms, s.good_sec"
                        + " FROM " + ms + " s WHERE s.client_session_uuid = ?", clientSessionUuid);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> v = new LinkedHashMap<>(rows.get(0));
        Object id = v.get("monitor_session_id");
        v.put("events", jdbc.queryForList(
                "SELECT e.event_seq, " + String.format(off, "e.started_at") + " AS started_ms, "
                        + String.format(off, "e.confirmed_at") + " AS confirmed_ms, "
                        + String.format(off, "e.ended_at") + " AS ended_ms,"
                        // V2.3은 종료 사유 컬럼이 없어 시각으로 판정한다(schema_V2_3.sql collapse_event.ended_at 설명)
                        + " CASE WHEN e.recovered_at IS NOT NULL THEN 'RECOVERED' WHEN e.ended_at IS NULL THEN NULL"
                        + " WHEN e.ended_at = s.ended_at THEN 'SESSION_END' ELSE 'EXCLUDED' END AS end_kind, "
                        + String.format(off, "e.recovered_at") + " AS recovered_ms"
                        + " FROM " + ce + " e JOIN " + ms + " s ON s.monitor_session_id = e.monitor_session_id"
                        + " WHERE e.monitor_session_id = ? ORDER BY e.event_seq", id));
        v.put("alerts", jdbc.queryForList(
                "SELECT a.event_seq, " + String.format(off, "a.attempted_at") + " AS attempted_ms,"
                        + " s.alert_enabled AS displayed"
                        + " FROM " + ca + " a JOIN " + ms + " s ON s.monitor_session_id = a.monitor_session_id"
                        + " WHERE a.monitor_session_id = ? ORDER BY a.event_seq, a.attempted_at", id));
        return Optional.of(v);
    }

    static OptionalInt firstInt(List<Long> values) {
        return values.isEmpty() || values.get(0) == null ? OptionalInt.empty() : OptionalInt.of(values.get(0).intValue());
    }

    static long num(Object o) {
        if (o instanceof Number n) {
            return n.longValue();
        }
        if (o instanceof Boolean b) {
            return b ? 1 : 0;
        }
        throw new IllegalStateException("숫자가 아님: " + o);
    }

    static boolean bool(Object o) {
        if (o instanceof Boolean b) {
            return b;
        }
        return num(o) != 0;
    }
}
