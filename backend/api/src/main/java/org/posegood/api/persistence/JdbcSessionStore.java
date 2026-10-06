package org.posegood.api.persistence;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

import org.posegood.api.application.SessionSetup;
import org.posegood.contracts.*;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Schema V1.1 session storage. `monitor_session` holds the frozen setup; `input_result` and
 * `cep_outbox` hold original inference outputs and delivery state; `confirmed_snapshot` holds
 * acknowledged views (the latest as the full view, earlier ones as compact proofs); CEP events
 * are decomposed into `collapse_event`, `correction_alert` and, at the end, `excluded_interval`.
 */
@Repository
@Profile("persistent")
public class JdbcSessionStore {
    public static final String PENDING = "PENDING";
    public static final String CONFIRMED = "CONFIRMED";
    public static final String REJECTED = "REJECTED";
    public static final String FEATURE = "FEATURE";
    public static final String OBSERVATION = "OBSERVATION";
    /** Same value as `model_version.feature_version` of the rule models (seed_03). */
    public static final String FEATURE_VERSION = "FEAT-PROTO-1";

    private static final String KEY =
            "(SELECT monitor_session_id FROM monitor_session WHERE client_session_uuid=?)";
    private static final String LATEST = "JSON_CONTAINS_PATH(payload,'one','$.events')";
    private static final String SESSION =
            "SELECT m.monitor_session_id,m.client_session_uuid,m.user_account_id,m.alert_enabled,"
                + "m.frame_width,m.frame_height,m.started_at,m.ended_at,p.threshold,p.hold_seconds,"
                + "p.recover_seconds,p.realert_seconds,p.notify_max_per_hour,b.calibration_uuid,"
                + "d.browser_device_key,(SELECT c.payload FROM confirmed_snapshot c WHERE"
                + " c.monitor_session_id=m.monitor_session_id AND"
                + " JSON_CONTAINS_PATH(c.payload,'one','$.events') LIMIT 1) AS snapshot,(SELECT"
                + " JSON_UNQUOTE(JSON_EXTRACT(i.observation,'$.model_version')) FROM input_result i"
                + " WHERE i.monitor_session_id=m.monitor_session_id ORDER BY i.input_seq LIMIT 1)"
                + " AS model_version FROM monitor_session m JOIN threshold_policy p ON"
                + " p.threshold_policy_id=m.threshold_policy_id JOIN baseline_posture b ON"
                + " b.baseline_posture_id=m.baseline_posture_id JOIN capture_device d ON"
                + " d.capture_device_id=m.capture_device_id";

    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final TransactionTemplate tx;
    private final ThresholdPolicyStore policies;
    /** Rotation order only; V1.1 has no column for it and a restart may retry in any order. */
    private final Map<UUID, Instant> recoveryAttempts = new ConcurrentHashMap<>();

    public JdbcSessionStore(
            JdbcTemplate jdbc,
            JsonCodec json,
            TransactionTemplate tx,
            ThresholdPolicyStore policies) {
        this.jdbc = jdbc;
        this.json = json;
        this.tx = tx;
        this.policies = policies;
    }

    public Stored require(long owner, UUID id) {
        var rows =
                jdbc.query(
                        SESSION + " WHERE m.client_session_uuid=? AND m.user_account_id=?",
                        this::session,
                        id.toString(),
                        owner);
        if (rows.isEmpty()) throw new ContractError(404, "session not found");
        return rows.getFirst();
    }

    public Stored find(UUID id) {
        var rows =
                jdbc.query(
                        SESSION + " WHERE m.client_session_uuid=?", this::session, id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /** Registers the device and baseline (D-27, D-35) and the session in one transaction. */
    public Stored create(
            long owner,
            UUID id,
            Policy policy,
            SessionSetup setup,
            boolean alertEnabled,
            String modelVersionCode,
            SessionView empty) {
        var values = ThresholdPolicyStore.of(policy);
        try {
            tx.executeWithoutResult(
                    status -> {
                        var now = DbTime.now();
                        long device = device(owner, setup.device(), now);
                        long baseline = baseline(owner, setup.baseline(), now);
                        jdbc.update(
                                "INSERT INTO monitor_session(client_session_uuid,user_account_id,"
                                    + "capture_device_id,baseline_posture_id,threshold_policy_id,"
                                    + "model_version_code,alert_enabled,frame_width,frame_height,"
                                    + "started_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                                id.toString(),
                                owner,
                                device,
                                baseline,
                                policies.resolve(values),
                                modelVersionCode,
                                alertEnabled,
                                setup.frame().width(),
                                setup.frame().height(),
                                now);
                        saveLatest(
                                jdbc.queryForObject(
                                        "SELECT monitor_session_id FROM monitor_session WHERE"
                                                + " client_session_uuid=?",
                                        Long.class,
                                        id.toString()),
                                empty);
                    });
        } catch (DuplicateKeyException duplicate) {
            return require(owner, id);
        }
        return require(owner, id);
    }

    public Input input(UUID id, long sequence) {
        var rows =
                jdbc.query(
                        "SELECT * FROM input_result WHERE monitor_session_id=" + KEY
                                + " AND input_seq=?",
                        this::input,
                        id.toString(),
                        sequence);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Input pending(UUID id) {
        var rows =
                jdbc.query(
                        "SELECT * FROM input_result WHERE monitor_session_id=" + KEY
                                + " AND process_status='PENDING' ORDER BY input_seq LIMIT 1",
                        this::input,
                        id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public List<Observation> accepted(UUID id) {
        return jdbc.query(
                "SELECT observation FROM input_result WHERE monitor_session_id=" + KEY
                        + " AND process_status='CONFIRMED' ORDER BY input_seq",
                (row, n) -> json.read(row.getString(1), Observation.class),
                id.toString());
    }

    public int inputCount(UUID id) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM input_result WHERE monitor_session_id=" + KEY,
                Integer.class,
                id.toString());
    }

    public void queue(Stored session, String kind, String digest, Observation observation) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "INSERT INTO input_result(monitor_session_id,input_seq,input_kind,"
                                    + "request_fingerprint,observation,process_status)"
                                    + " VALUES(?,?,?,?,?,'PENDING')",
                            session.key(),
                            observation.sequence(),
                            kind,
                            digest,
                            json.write(observation));
                    jdbc.update(
                            "INSERT INTO cep_outbox(monitor_session_id,input_seq) VALUES(?,?)",
                            session.key(),
                            observation.sequence());
                });
    }

    public void confirm(Stored old, Input input, SessionView view) {
        requireProgress(old.view(), view);
        tx.executeWithoutResult(
                status -> {
                    saveSnapshot(old, view);
                    jdbc.update(
                            "UPDATE input_result SET process_status='CONFIRMED' WHERE"
                                    + " monitor_session_id=? AND input_seq=? AND"
                                    + " process_status='PENDING'",
                            old.key(),
                            input.observation().sequence());
                    jdbc.update(
                            "UPDATE cep_outbox SET completed=TRUE WHERE monitor_session_id=? AND"
                                    + " input_seq=?",
                            old.key(),
                            input.observation().sequence());
                });
    }

    public void reject(UUID id, Input input, int statusCode) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "UPDATE input_result SET process_status='REJECTED',rejection_status=?"
                                    + " WHERE monitor_session_id=" + KEY + " AND input_seq=?",
                            statusCode,
                            id.toString(),
                            input.observation().sequence());
                    jdbc.update(
                            "UPDATE cep_outbox SET completed=TRUE WHERE monitor_session_id=" + KEY
                                    + " AND input_seq=?",
                            id.toString(),
                            input.observation().sequence());
                });
    }

    /** Closes the session row with its summary and derived exclusion intervals. */
    public void confirmEnd(Stored old, SessionView view) {
        requireProgress(old.view(), view);
        tx.executeWithoutResult(
                status -> {
                    saveSnapshot(old, view);
                    int closed =
                            jdbc.update(
                                    "UPDATE monitor_session SET ended_at=?,end_reason='USER_STOP',"
                                            + "good_sec=? WHERE monitor_session_id=? AND ended_at"
                                            + " IS NULL",
                                    at(old, view.summary().totalMs()),
                                    BigDecimal.valueOf(view.summary().normalMs(), 3)
                                            .setScale(1, RoundingMode.DOWN),
                                    old.key());
                    if (closed == 1) saveExclusions(old, view.summary().totalMs());
                    jdbc.update(
                            "INSERT IGNORE INTO cep_cleanup(client_session_uuid,created_at)"
                                    + " VALUES(?,?)",
                            old.id().toString(),
                            DbTime.now());
                });
    }

    public void delete(long owner, UUID id) {
        var session = require(owner, id);
        try {
            tx.executeWithoutResult(
                    status -> {
                        jdbc.update(
                                "INSERT IGNORE INTO cep_cleanup(client_session_uuid,created_at)"
                                        + " VALUES(?,?)",
                                id.toString(),
                                DbTime.now());
                        jdbc.update(
                                "DELETE FROM client_record WHERE user_account_id=? AND"
                                        + " client_record_id=?",
                                owner,
                                id.toString());
                        jdbc.update(
                                "DELETE FROM monitor_session WHERE monitor_session_id=?",
                                session.key());
                    });
        } catch (DataIntegrityViolationException archived) {
            // `feature_archive` rows are removed by the batch that deletes their files first.
            throw new ContractError(409, "session has archived feature files");
        }
        recoveryAttempts.remove(id);
    }

    public List<UUID> recoveryCandidates() {
        var pending =
                jdbc.query(
                        "SELECT m.client_session_uuid FROM monitor_session m WHERE EXISTS(SELECT 1"
                                + " FROM cep_outbox o WHERE"
                                + " o.monitor_session_id=m.monitor_session_id AND"
                                + " o.completed=FALSE) ORDER BY m.monitor_session_id LIMIT 1024",
                        (row, n) -> UUID.fromString(row.getString(1)));
        recoveryAttempts.keySet().retainAll(pending);
        return pending.stream()
                .sorted(
                        Comparator.comparing(
                                (UUID id) -> recoveryAttempts.getOrDefault(id, Instant.MIN)))
                .limit(32)
                .toList();
    }

    public List<UUID> cleanupCandidates() {
        return jdbc.query(
                "SELECT client_session_uuid FROM cep_cleanup ORDER BY attempted_at IS NOT"
                        + " NULL,attempted_at,created_at,client_session_uuid LIMIT 32",
                (row, n) -> UUID.fromString(row.getString(1)));
    }

    public void cleanupComplete(UUID id) {
        jdbc.update("DELETE FROM cep_cleanup WHERE client_session_uuid=?", id.toString());
    }

    public void markRecoveryAttempt(UUID id) {
        recoveryAttempts.put(id, Instant.now());
    }

    public void markCleanupAttempt(UUID id) {
        jdbc.update(
                "UPDATE cep_cleanup SET attempted_at=? WHERE client_session_uuid=?",
                DbTime.now(),
                id.toString());
    }

    public boolean wasConfirmed(UUID id, SessionView view) {
        var rows =
                jdbc.query(
                        "SELECT payload FROM confirmed_snapshot WHERE monitor_session_id=" + KEY
                                + " AND snapshot_fingerprint=?",
                        (row, n) -> row.getString(1),
                        id.toString(),
                        json.fingerprint(json.tree(view)));
        if (rows.isEmpty()) return false;
        String payload = rows.getFirst();
        if (json.read(payload, JsonNode.class).has("proof_version"))
            return json.read(payload, SnapshotProof.class).equals(SnapshotProof.of(view));
        return json.read(payload, SessionView.class).equals(view);
    }

    private long device(long owner, SessionSetup.Device device, LocalDateTime now) {
        jdbc.update(
                "INSERT INTO capture_device(user_account_id,browser_device_key,device_label,"
                        + "registered_at) VALUES(?,?,?,?) AS fresh ON DUPLICATE KEY UPDATE"
                        + " device_label=fresh.device_label",
                owner,
                device.key(),
                device.label(),
                now);
        return jdbc.queryForObject(
                "SELECT capture_device_id FROM capture_device WHERE user_account_id=? AND"
                        + " browser_device_key=?",
                Long.class,
                owner,
                device.key());
    }

    /** A new calibration replaces the active baseline; a reused one must be identical. */
    private long baseline(long owner, SessionSetup.Baseline baseline, LocalDateTime now) {
        var stored =
                jdbc.query(
                        "SELECT baseline_posture_id,user_account_id,deactivated_at FROM"
                                + " baseline_posture WHERE calibration_uuid=?",
                        (row, n) ->
                                new Object[] {
                                    row.getLong(1), row.getLong(2), row.getObject(3)
                                },
                        baseline.baselineId().toString());
        var features =
                List.of(
                        Map.entry("HEAD_GAP", baseline.headGap()),
                        Map.entry("LATERAL_OFFSET", baseline.lateralOffset()),
                        Map.entry("SHOULDER_TILT", baseline.shoulderTilt()));
        if (!stored.isEmpty()) {
            var row = stored.getFirst();
            long id = (Long) row[0];
            if ((Long) row[1] != owner) throw new ContractError(409, "baseline conflict");
            if (row[2] != null) throw new ContractError(409, "baseline was replaced");
            Integer same =
                    jdbc.queryForObject(
                            "SELECT COUNT(*) FROM baseline_posture WHERE baseline_posture_id=? AND"
                                    + " calibration_sec=? AND sample_count=? AND"
                                    + " target_center_x=? AND target_center_y=? AND"
                                    + " target_area_ratio=?",
                            Integer.class,
                            id,
                            seconds(baseline.calibrationMs()),
                            baseline.sampleCount(),
                            ratio(baseline.targetCenterX()),
                            ratio(baseline.targetCenterY()),
                            ratio(baseline.targetAreaRatio()));
            for (var feature : features)
                same +=
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM baseline_feature WHERE"
                                        + " baseline_posture_id=? AND feature_code=? AND"
                                        + " mean_value=? AND std_value=?",
                                Integer.class,
                                id,
                                feature.getKey(),
                                value(feature.getValue().mean()),
                                value(feature.getValue().std()));
            if (same != 1 + features.size()) throw new ContractError(409, "baseline conflict");
            return id;
        }
        jdbc.update(
                "UPDATE baseline_posture SET deactivated_at=? WHERE user_account_id=? AND"
                        + " deactivated_at IS NULL",
                now,
                owner);
        jdbc.update(
                "INSERT INTO baseline_posture(user_account_id,calibration_uuid,feature_version,"
                        + "calibration_sec,sample_count,normalization_scale,target_center_x,"
                        + "target_center_y,target_area_ratio,registered_at)"
                        + " VALUES(?,?,?,?,?,NULL,?,?,?,?)",
                owner,
                baseline.baselineId().toString(),
                FEATURE_VERSION,
                seconds(baseline.calibrationMs()),
                baseline.sampleCount(),
                ratio(baseline.targetCenterX()),
                ratio(baseline.targetCenterY()),
                ratio(baseline.targetAreaRatio()),
                now);
        long id =
                jdbc.queryForObject(
                        "SELECT baseline_posture_id FROM baseline_posture WHERE"
                                + " calibration_uuid=?",
                        Long.class,
                        baseline.baselineId().toString());
        for (var feature : features)
            jdbc.update(
                    "INSERT INTO baseline_feature(baseline_posture_id,feature_code,mean_value,"
                            + "std_value) VALUES(?,?,?,?)",
                    id,
                    feature.getKey(),
                    value(feature.getValue().mean()),
                    value(feature.getValue().std()));
        return id;
    }

    private void saveSnapshot(Stored old, SessionView view) {
        saveLatest(old.key(), view);
        // requireProgress already checked the complete immutable prefix against the saved view.
        saveEvents(old, view.events().subList(old.view().events().size(), view.events().size()));
    }

    /** Exactly one full view per session; earlier acknowledged views remain as proofs. */
    private void saveLatest(long key, SessionView view) {
        var previous =
                jdbc.query(
                        "SELECT snapshot_fingerprint,payload FROM confirmed_snapshot WHERE"
                                + " monitor_session_id=? AND " + LATEST,
                        (row, n) -> new String[] {row.getString(1), row.getString(2)},
                        key);
        for (var row : previous)
            jdbc.update(
                    "UPDATE confirmed_snapshot SET payload=? WHERE monitor_session_id=? AND"
                            + " snapshot_fingerprint=?",
                    json.write(SnapshotProof.of(json.read(row[1], SessionView.class))),
                    key,
                    row[0]);
        jdbc.update(
                "INSERT INTO confirmed_snapshot(monitor_session_id,snapshot_fingerprint,payload)"
                        + " VALUES(?,?,?) AS fresh ON DUPLICATE KEY UPDATE payload=fresh.payload",
                key,
                json.fingerprint(json.tree(view)),
                json.write(view));
    }

    /** Maps CEP decisions onto the episode tables; a pre-existing row means history changed. */
    private void saveEvents(Stored session, List<DecisionEvent> added) {
        // Episode numbers follow the acknowledged prefix, so a conflicting stored row is detected.
        int seq =
                (int)
                        session.view().events().stream()
                                .filter(event -> "collapse_confirmed".equals(event.kind()))
                                .count();
        for (var event : added) {
            var onset = at(session, event.onsetMs());
            var at = at(session, event.timestampMs());
            switch (event.kind()) {
                case "collapse_confirmed" -> {
                    seq++;
                    try {
                        jdbc.update(
                                "INSERT INTO collapse_event(monitor_session_id,event_seq,"
                                        + "started_at,confirmed_at) VALUES(?,?,?,?)",
                                session.key(),
                                seq,
                                onset,
                                at);
                    } catch (DuplicateKeyException changed) {
                        throw new ContractError(502, "CEP changed a confirmed event");
                    }
                    alert(session, seq, at);
                }
                case "reminder" -> alert(session, open(session, onset), at);
                case "recovery_confirmed" ->
                        jdbc.update(
                                "UPDATE collapse_event SET ended_at=?,end_reason='RECOVERED',"
                                        + "recovered_at=? WHERE monitor_session_id=? AND"
                                        + " event_seq=?",
                                at,
                                at,
                                session.key(),
                                open(session, onset));
                case "interrupted" ->
                        jdbc.update(
                                "UPDATE collapse_event SET ended_at=?,end_reason=? WHERE"
                                        + " monitor_session_id=? AND event_seq=?",
                                at,
                                "ended".equals(event.reason()) ? "SESSION_END" : "EXCLUDED",
                                session.key(),
                                open(session, onset));
                case "session_ended" -> {
                    /* The session row records the end. */
                }
                default -> throw new ContractError(502, "unknown CEP event kind");
            }
        }
    }

    private int open(Stored session, LocalDateTime onset) {
        var rows =
                jdbc.queryForList(
                        "SELECT event_seq FROM collapse_event WHERE monitor_session_id=? AND"
                                + " started_at=? AND ended_at IS NULL",
                        Integer.class,
                        session.key(),
                        onset);
        if (rows.size() != 1) throw new ContractError(502, "CEP event has no open collapse");
        return rows.getFirst();
    }

    private void alert(Stored session, int seq, LocalDateTime at) {
        jdbc.update(
                "INSERT INTO correction_alert(monitor_session_id,event_seq,attempt_seq,"
                        + "attempted_at,delivered,suppress_reason) SELECT ?,?,COUNT(*)+1,?,?,? FROM"
                        + " correction_alert WHERE monitor_session_id=? AND event_seq=?",
                session.key(),
                seq,
                at,
                session.alertEnabled(),
                session.alertEnabled() ? null : "ALERT_OFF",
                session.key(),
                seq);
    }

    /** Pause, absence, unmeasurable and missing (gap) spans of the confirmed input timeline. */
    private void saveExclusions(Stored session, long totalMs) {
        List<long[]> spans = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        long cursor = 0;
        for (var observation : accepted(session.id())) {
            if (observation.startMs() > cursor)
                exclude(spans, reasons, cursor, observation.startMs(), "MISSING");
            String reason =
                    switch (observation.phase()) {
                        case rest -> "PAUSE";
                        case away -> "ABSENCE";
                        case running -> observation.valid() ? null : "UNMEASURABLE";
                    };
            if (reason != null)
                exclude(spans, reasons, observation.startMs(), observation.endMs(), reason);
            cursor = Math.max(cursor, observation.endMs());
        }
        if (totalMs > cursor) exclude(spans, reasons, cursor, totalMs, "MISSING");
        for (int n = 0; n < spans.size(); n++)
            jdbc.update(
                    "INSERT INTO excluded_interval(monitor_session_id,started_at,ended_at,"
                            + "exclusion_reason) VALUES(?,?,?,?)",
                    session.key(),
                    at(session, spans.get(n)[0]),
                    at(session, spans.get(n)[1]),
                    reasons.get(n));
    }

    private static void exclude(
            List<long[]> spans, List<String> reasons, long from, long to, String reason) {
        int last = spans.size() - 1;
        if (last >= 0 && reasons.get(last).equals(reason) && spans.get(last)[1] == from)
            spans.get(last)[1] = to;
        else {
            spans.add(new long[] {from, to});
            reasons.add(reason);
        }
    }

    private void requireProgress(SessionView old, SessionView next) {
        if (!old.sessionId().equals(next.sessionId())
                || !old.policy().equals(next.policy())
                || !old.timerPolicy().equals(next.timerPolicy())
                || next.lastSequence() < old.lastSequence()
                || next.summary().totalMs() < old.summary().totalMs()
                || (old.ended() && !next.ended())
                || next.events().size() < old.events().size()
                || !next.events().subList(0, old.events().size()).equals(old.events()))
            throw new ContractError(502, "CEP snapshot regressed or changed confirmed events");
    }

    private static LocalDateTime at(Stored session, long elapsedMs) {
        return DbTime.of(session.startedAt().plusMillis(elapsedMs));
    }

    private static BigDecimal seconds(long ms) {
        return BigDecimal.valueOf(ms, 3).setScale(1, RoundingMode.DOWN);
    }

    private static BigDecimal ratio(double value) {
        return BigDecimal.valueOf(value).setScale(3, RoundingMode.HALF_UP);
    }

    private static BigDecimal value(double value) {
        return BigDecimal.valueOf(value).setScale(6, RoundingMode.HALF_UP);
    }

    private Stored session(ResultSet row, int n) throws SQLException {
        var policy =
                new ThresholdPolicyStore.Values(
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
                json.read(row.getString("snapshot"), SessionView.class),
                UUID.fromString(row.getString("calibration_uuid")),
                row.getString("model_version"),
                row.getBoolean("alert_enabled"),
                row.getString("browser_device_key"),
                row.getInt("frame_width"),
                row.getInt("frame_height"),
                DbTime.read(row, "started_at"),
                DbTime.read(row, "ended_at"));
    }

    private Input input(ResultSet row, int n) throws SQLException {
        return new Input(
                row.getString("input_kind"),
                row.getString("request_fingerprint"),
                json.read(row.getString("observation"), Observation.class),
                row.getString("process_status"),
                row.getInt("rejection_status"));
    }

    /** {@code modelVersion} is the first saved inference output's model, or null. */
    public record Stored(
            long key,
            UUID id,
            long owner,
            Policy policy,
            SessionView view,
            UUID baseline,
            String modelVersion,
            boolean alertEnabled,
            String deviceKey,
            int frameWidth,
            int frameHeight,
            Instant startedAt,
            Instant endedAt) {}

    public record Input(
            String kind,
            String fingerprint,
            Observation observation,
            String status,
            int rejectionStatus) {}

    /** The canonical view digest is the proof; metadata never duplicates the event history. */
    private record SnapshotProof(
            @JsonProperty("proof_version") int proofVersion,
            @JsonProperty("session_id") UUID sessionId,
            @JsonProperty("last_sequence") long lastSequence,
            @JsonProperty("total_ms") long totalMs,
            boolean ended,
            @JsonProperty("event_count") int eventCount) {
        static SnapshotProof of(SessionView view) {
            return new SnapshotProof(
                    1,
                    view.sessionId(),
                    view.lastSequence(),
                    view.summary().totalMs(),
                    view.ended(),
                    view.events().size());
        }
    }
}
