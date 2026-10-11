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
 * 측정 SQL 모음: 세션, 기준 자세, 붕괴 사건, 알림, 제외 구간, 일별 통계.
 *
 * 쓰기는 호출한 쪽의 트랜잭션 안에서 한다. 세션 경과 ms는 `monitor_session.started_at` 기준
 * KST {@code DATETIME(3)}으로 바꿔 저장한다.
 */
@Repository("monitorSessionRepository") // Spring Session JDBC가 "sessionRepository" 이름을 이미 쓴다
public class SessionRepository {
    /** `baseline_posture` 좌표 컬럼({@link SessionRequests.Landmarks#points()} 순서). */
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

    /** 세션 UUID로 행 조회(정책 값·사건 수 포함). */
    public Stored find(UUID id) {
        var rows = jdbc.query(SESSION + " WHERE m.client_session_uuid=?", this::stored, id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /**
     * 세션 행 추가.
     *
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
     * 기준 자세 저장(사용자당 1행, 새 보정이면 덮어쓰기).
     *
     * 현재 보정을 같은 값으로 다시 보내면 그대로 쓴다(BR-63). 세션에 쓰였다가 바뀐 보정이나
     * 다른 사용자의 보정(UK-04)이면 409.
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
     * 판정 사건 하나를 테이블에 반영: 붕괴 → collapse_event + 첫 알림,
     * 재알림 → 알림 추가, 회복·중단 → 사건 종료.
     *
     * {@code episode}는 이 사건이 속한 세션 안 순번(`collapse_event.event_seq`)이다.
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
                // 종료는 세션 행에 기록한다.
            }
            default -> throw new IllegalStateException("unknown decision kind");
        }
    }

    /**
     * 세션 종료 기록: 종료 3컬럼, 제외 구간, 일별 통계.
     *
     * 종료 시각·사유·바른 자세 시간은 함께 채운다(BR-35). 일별 통계는 세션 시작의 KST 날짜에 더한다(BR-61).
     * 이미 닫혔으면 false. {@code reason}은 USER_STOP, 앱이 종료 확인 없이 기록을 남기면 DISCONNECTED.
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
                        // VALUES()는 MySQL 8.0.16도 지원하려고 쓴다(행 별칭은 8.0.19부터).
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
     * 판정 상태를 잃은 세션을 ERROR로 닫는다.
     *
     * 이미 쓴 사건만 알 수 있다: 열린 사건은 세션과 함께 끝내고, 바른 자세 시간·제외 구간은 모르므로
     * good_sec 0, 제외 구간 없음, `daily_stat`은 바꾸지 않는다. {@code acknowledgedMs}는 앱이 마지막으로 받은
     * 세션 길이이며, 종료 시각은 저장된 사건보다 앞서지 않게 한다.
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

    /**
     * 세션 삭제(하위 행도 함께 지워짐).
     *
     * 특징 적재 파일이 있으면 지우지 않는다(FK-13, 409).
     */
    public void delete(Stored session) {
        try {
            jdbc.update("DELETE FROM monitor_session WHERE monitor_session_id=?", session.key());
        } catch (DataIntegrityViolationException archived) {
            throw ApiError.conflict("session has archived feature files");
        }
    }

    /**
     * 알림 시도 기록(자세 알림이 꺼진 세션이면 ALERT_OFF).
     *
     * 표시 여부는 세션의 알림 설정 값이다. 시간당 알림 상한은 아직 적용하지 않는다.
     */
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

    /** {@link #BASELINE_VALUES}를 컬럼 정밀도로 맞춘다: DECIMAL(4,1), INT, DECIMAL(6,5). */
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
     * 세션 행 하나.
     *
     * 고정된 정책, 복사한 보정 ID({@code baselineId}), 저장된 사건·알림 수를 함께 담는다.
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

    /**
     * 세션을 닫을 때 쓰는 값.
     */
    public record Closing(
            long totalMs,
            long validMs,
            long normalMs,
            long collapseCount,
            List<ExcludedSpan> excluded) {}
}
