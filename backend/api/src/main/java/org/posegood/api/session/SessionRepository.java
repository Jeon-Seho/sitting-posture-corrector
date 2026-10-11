package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.engine.ExcludedSpan;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Session tables of schema V2.2. Writes happen inside the caller's transaction. Elapsed session
 * milliseconds become KST {@code DATETIME(3)} values relative to `monitor_session.started_at`.
 */
@Repository("monitorSessionRepository") // Spring Session JDBC already defines "sessionRepository"
public class SessionRepository {
    /** `baseline_posture` coordinate columns in {@link SessionRequests.Landmarks#points()} order. */
    private static final List<String> LANDMARKS =
            List.of(
                    "nose",
                    "left_eye",
                    "right_eye",
                    "left_ear",
                    "right_ear",
                    "mouth_left",
                    "mouth_right",
                    "left_shoulder",
                    "right_shoulder");
    private static final List<String> BASELINE_VALUES = baselineValueColumns();

    private static final String SESSION =
            "SELECT m.monitor_session_id,m.client_session_uuid,m.user_account_id,m.calibration_uuid,"
                    + "m.alert_enabled,m.started_at,m.ended_at,m.end_reason,m.good_sec,p.threshold,"
                    + "p.hold_seconds,p.recover_seconds,p.realert_seconds,p.notify_max_per_hour,(SELECT"
                    + " COUNT(*) FROM collapse_event e WHERE e.monitor_session_id=m.monitor_session_id)"
                    + " AS collapse_count,(SELECT COUNT(*) FROM correction_alert a WHERE"
                    + " a.monitor_session_id=m.monitor_session_id) AS alert_count FROM monitor_session"
                    + " m JOIN threshold_policy p ON p.threshold_policy_id=m.threshold_policy_id";

    private final JdbcTemplate jdbc;

    public SessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Stored find(UUID id) {
        var rows = jdbc.query(SESSION + " WHERE m.client_session_uuid=?", this::stored, id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /**
     * The session row after its baseline: the calibration, the policy and the account's 「자세 알림」
     * setting are copied at the start (V2.1 B안, V2.2). The policy row is resolved by the caller.
     */
    public void insert(
            long owner,
            UUID id,
            long policyId,
            UUID calibration,
            boolean alertEnabled,
            LocalDateTime startedAt) {
        jdbc.update(
                "INSERT INTO monitor_session(client_session_uuid,user_account_id,calibration_uuid,"
                        + "threshold_policy_id,alert_enabled,started_at) VALUES(?,?,?,?,?,?)",
                id.toString(),
                owner,
                calibration.toString(),
                policyId,
                alertEnabled,
                startedAt);
    }

    /**
     * One `baseline_posture` row per user (V2.1): a new calibration overwrites it, and the current
     * calibration sent again is accepted when its values are the same (BR-63). A calibration that a
     * session already used but that was since replaced, or one held by another user (UK-04), is 409.
     */
    public void registerBaseline(long owner, SessionRequests.Baseline baseline, LocalDateTime now) {
        String calibration = baseline.baselineId().toString();
        var values = baselineValues(baseline);
        var current =
                jdbc.query(
                        "SELECT calibration_uuid," + String.join(",", BASELINE_VALUES)
                                + " FROM baseline_posture WHERE user_account_id=? FOR UPDATE",
                        (row, n) -> {
                            var stored = new ArrayList<BigDecimal>();
                            for (int column = 2; column <= BASELINE_VALUES.size() + 1; column++)
                                stored.add(row.getBigDecimal(column));
                            return Map.entry(row.getString(1), stored);
                        },
                        owner);
        if (!current.isEmpty() && current.getFirst().getKey().equals(calibration)) {
            if (!sameValues(current.getFirst().getValue(), values))
                throw ApiError.conflict("baseline conflict");
            return;
        }
        Integer used =
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM monitor_session WHERE user_account_id=? AND calibration_uuid=?",
                        Integer.class,
                        owner,
                        calibration);
        if (used != null && used > 0) throw ApiError.conflict("baseline was replaced");
        var arguments = new ArrayList<Object>();
        arguments.add(calibration);
        arguments.add(now);
        arguments.addAll(values);
        arguments.add(owner);
        try {
            if (current.isEmpty())
                jdbc.update(
                        "INSERT INTO baseline_posture(calibration_uuid,registered_at,"
                                + String.join(",", BASELINE_VALUES) + ",user_account_id) VALUES("
                                + "?,".repeat(BASELINE_VALUES.size() + 2) + "?)",
                        arguments.toArray());
            else
                jdbc.update(
                        "UPDATE baseline_posture SET calibration_uuid=?,registered_at=?,"
                                + String.join("=?,", BASELINE_VALUES) + "=? WHERE user_account_id=?",
                        arguments.toArray());
        } catch (DuplicateKeyException taken) {
            throw ApiError.conflict("baseline conflict");
        }
    }

    /**
     * Decomposes one decision into the episode tables. {@code episode} is the session-local
     * `collapse_event.event_seq` the decision belongs to.
     */
    public void applyEvent(Stored session, DecisionEvent event, int episode) {
        var at = at(session, event.timestampMs());
        switch (event.kind()) {
            case "collapse_confirmed" -> {
                jdbc.update(
                        "INSERT INTO collapse_event(monitor_session_id,event_seq,started_at,"
                                + "confirmed_at) VALUES(?,?,?,?)",
                        session.key(),
                        episode,
                        at(session, event.onsetMs()),
                        at);
                alert(session, episode, at);
            }
            case "reminder" -> alert(session, episode, at);
            case "recovery_confirmed" ->
                    jdbc.update(
                            "UPDATE collapse_event SET ended_at=?,end_reason='RECOVERED',"
                                    + "recovered_at=? WHERE monitor_session_id=? AND event_seq=?",
                            at,
                            at,
                            session.key(),
                            episode);
            case "interrupted" ->
                    jdbc.update(
                            "UPDATE collapse_event SET ended_at=?,end_reason=? WHERE"
                                    + " monitor_session_id=? AND event_seq=?",
                            at,
                            "ended".equals(event.reason()) ? "SESSION_END" : "EXCLUDED",
                            session.key(),
                            episode);
            case "session_ended" -> {
                // The session row records the end.
            }
            default -> throw new IllegalStateException("unknown decision kind");
        }
    }

    /**
     * Closes the row once: end time, reason and good time together (BR-35), the exclusion spans,
     * and the KST day of the session start in `daily_stat` (BR-61). Returns false if already closed.
     * {@code reason} is USER_STOP, or DISCONNECTED when the app archived without an end.
     */
    public boolean close(Stored session, Closing closing, String reason) {
        int closed =
                jdbc.update(
                        "UPDATE monitor_session SET ended_at=?,end_reason=?,good_sec=? WHERE"
                                + " monitor_session_id=? AND ended_at IS NULL",
                        at(session, closing.totalMs()),
                        reason,
                        tenths(closing.normalMs()),
                        session.key());
        if (closed != 1) return false;
        for (var span : closing.excluded())
            jdbc.update(
                    "INSERT INTO excluded_interval(monitor_session_id,started_at,ended_at,"
                            + "exclusion_reason) VALUES(?,?,?,?)",
                    session.key(),
                    at(session, span.startMs()),
                    at(session, span.endMs()),
                    span.reason().name());
        jdbc.update(
                "INSERT INTO daily_stat(user_account_id,stat_date,valid_sec,good_sec,session_count,"
                        + "event_count,alerted_event_count,computed_at) VALUES(?,?,?,?,1,?,?,?)"
                        // VALUES() keeps MySQL 8.0.16 support (row aliases need 8.0.19).
                        + " ON DUPLICATE KEY UPDATE valid_sec=valid_sec+VALUES(valid_sec),"
                        + "good_sec=good_sec+VALUES(good_sec),session_count=session_count+1,"
                        + "event_count=event_count+VALUES(event_count),"
                        + "alerted_event_count=alerted_event_count+VALUES(alerted_event_count),"
                        + "computed_at=VALUES(computed_at)",
                session.owner(),
                KstTime.day(session.startedAt()),
                tenths(closing.validMs()),
                tenths(closing.normalMs()),
                closing.collapseCount(),
                session.alertEnabled() ? closing.collapseCount() : 0,
                KstTime.now());
        return true;
    }

    /**
     * Closes a row whose decision state was lost (API restart) as ERROR. Only the decisions already
     * written are known: open episodes end with the session, good time and exclusions are unknown
     * (good_sec 0, no exclusion rows) and `daily_stat` is not changed. {@code acknowledgedMs} is the
     * session length the app last received; the end never precedes a stored decision.
     */
    public boolean closeLost(Stored session, long acknowledgedMs) {
        LocalDateTime last =
                jdbc.queryForObject(
                        "SELECT MAX(t) FROM (SELECT MAX(COALESCE(ended_at,confirmed_at)) AS t FROM"
                                + " collapse_event WHERE monitor_session_id=? UNION ALL SELECT"
                                + " MAX(attempted_at) FROM correction_alert WHERE monitor_session_id=?) x",
                        (row, n) -> row.getObject(1, LocalDateTime.class),
                        session.key(),
                        session.key());
        var end = at(session, acknowledgedMs);
        if (last != null && last.isAfter(end)) end = last;
        int closed =
                jdbc.update(
                        "UPDATE monitor_session SET ended_at=?,end_reason='ERROR',good_sec=0 WHERE"
                                + " monitor_session_id=? AND ended_at IS NULL",
                        end,
                        session.key());
        if (closed != 1) return false;
        jdbc.update(
                "UPDATE collapse_event SET ended_at=?,end_reason='SESSION_END' WHERE"
                        + " monitor_session_id=? AND ended_at IS NULL",
                end,
                session.key());
        return true;
    }

    /** Deletes the session with its decisions; archived feature files block it (FK-13). */
    public void delete(Stored session) {
        try {
            jdbc.update("DELETE FROM monitor_session WHERE monitor_session_id=?", session.key());
        } catch (DataIntegrityViolationException archived) {
            throw ApiError.conflict("session has archived feature files");
        }
    }

    /** Delivery is recorded as the session's alert setting; the hourly cap is not applied. */
    private void alert(Stored session, int episode, LocalDateTime at) {
        jdbc.update(
                "INSERT INTO correction_alert(monitor_session_id,event_seq,attempt_seq,attempted_at,"
                        + "delivered,suppress_reason) SELECT ?,?,COUNT(*)+1,?,?,? FROM"
                        + " correction_alert WHERE monitor_session_id=? AND event_seq=?",
                session.key(),
                episode,
                at,
                session.alertEnabled(),
                session.alertEnabled() ? null : "ALERT_OFF",
                session.key(),
                episode);
    }

    private static LocalDateTime at(Stored session, long elapsedMs) {
        return KstTime.of(session.startedAt().plusMillis(elapsedMs));
    }

    private static List<String> baselineValueColumns() {
        var columns = new ArrayList<String>(List.of("calibration_sec", "sample_count"));
        for (var landmark : LANDMARKS) {
            columns.add(landmark + "_x");
            columns.add(landmark + "_y");
        }
        return List.copyOf(columns);
    }

    /** {@link #BASELINE_VALUES} at column precision: DECIMAL(4,1), INT, then DECIMAL(6,5). */
    private static List<BigDecimal> baselineValues(SessionRequests.Baseline baseline) {
        var values = new ArrayList<BigDecimal>();
        values.add(seconds(baseline.calibrationMs()));
        values.add(BigDecimal.valueOf(baseline.sampleCount()));
        for (var point : baseline.landmarks().points()) {
            values.add(coordinate(point.x()));
            values.add(coordinate(point.y()));
        }
        return values;
    }

    private static boolean sameValues(List<BigDecimal> stored, List<BigDecimal> sent) {
        if (stored.size() != sent.size()) return false;
        for (int i = 0; i < sent.size(); i++) if (stored.get(i).compareTo(sent.get(i)) != 0) return false;
        return true;
    }

    static BigDecimal tenths(long ms) {
        return BigDecimal.valueOf(ms, 3).setScale(1, RoundingMode.DOWN);
    }

    private static BigDecimal seconds(long ms) {
        return BigDecimal.valueOf(ms, 3).setScale(1, RoundingMode.DOWN);
    }

    private static BigDecimal coordinate(double value) {
        return BigDecimal.valueOf(value).setScale(5, RoundingMode.HALF_UP);
    }

    private Stored stored(ResultSet row, int n) throws SQLException {
        var policy =
                new ThresholdPolicyRepository.Values(
                                row.getBigDecimal("threshold"),
                                row.getBigDecimal("hold_seconds"),
                                row.getBigDecimal("recover_seconds"),
                                row.getInt("realert_seconds"),
                                row.getInt("notify_max_per_hour"))
                        .policy();
        return new Stored(
                row.getLong("monitor_session_id"),
                UUID.fromString(row.getString("client_session_uuid")),
                row.getLong("user_account_id"),
                policy,
                UUID.fromString(row.getString("calibration_uuid")),
                row.getBoolean("alert_enabled"),
                KstTime.read(row, "started_at"),
                KstTime.read(row, "ended_at"),
                row.getString("end_reason"),
                row.getBigDecimal("good_sec"),
                row.getLong("collapse_count"),
                row.getLong("alert_count"));
    }

    /**
     * One `monitor_session` row with its frozen policy, copied calibration ({@code baselineId}) and
     * stored episode counts.
     */
    public record Stored(
            long key,
            UUID id,
            long owner,
            Policy policy,
            UUID baselineId,
            boolean alertEnabled,
            Instant startedAt,
            Instant endedAt,
            String endReason,
            BigDecimal goodSec,
            long collapseCount,
            long alertCount) {}

    /** Values written when a session ends. */
    public record Closing(
            long totalMs,
            long validMs,
            long normalMs,
            long collapseCount,
            List<ExcludedSpan> excluded) {}
}
