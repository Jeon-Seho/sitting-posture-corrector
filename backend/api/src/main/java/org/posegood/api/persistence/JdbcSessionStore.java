package org.posegood.api.persistence;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

import org.posegood.contracts.*;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Durable original inference outputs, delivery state, and verified CEP aggregates. */
@Repository
@Profile("persistent")
public class JdbcSessionStore {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final TransactionTemplate tx;

    public JdbcSessionStore(JdbcTemplate jdbc, JsonCodec json, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.json = json;
        this.tx = tx;
    }

    public Stored require(UUID owner, UUID id) {
        var rows =
                jdbc.query(
                        "SELECT * FROM measurement_sessions WHERE id=? AND user_id=?",
                        this::session,
                        id.toString(),
                        owner.toString());
        if (rows.isEmpty()) throw new ContractError(404, "session not found");
        return rows.getFirst();
    }

    public Stored find(UUID id) {
        var rows =
                jdbc.query(
                        "SELECT * FROM measurement_sessions WHERE id=?",
                        this::session,
                        id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Stored create(UUID owner, UUID id, Policy policy, SessionView empty) {
        try {
            tx.executeWithoutResult(
                    status -> {
                        jdbc.update(
                                "INSERT INTO measurement_sessions(id,user_id,policy,snapshot)"
                                        + " VALUES(?,?,?,?)",
                                id.toString(),
                                owner.toString(),
                                json.write(policy),
                                json.write(empty));
                        rememberSnapshot(id, empty);
                    });
        } catch (DuplicateKeyException duplicate) {
            return require(owner, id);
        }
        return require(owner, id);
    }

    public List<Stored> list(UUID owner) {
        return jdbc.query(
                "SELECT * FROM measurement_sessions WHERE user_id=? ORDER BY started_at DESC",
                this::session,
                owner.toString());
    }

    public Input input(UUID id, long sequence) {
        var rows =
                jdbc.query(
                        "SELECT * FROM input_results WHERE session_id=? AND sequence=?",
                        this::input,
                        id.toString(),
                        sequence);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Input pending(UUID id) {
        var rows =
                jdbc.query(
                        "SELECT * FROM input_results WHERE session_id=? AND status='pending' ORDER"
                                + " BY sequence LIMIT 1",
                        this::input,
                        id.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public List<Observation> accepted(UUID id) {
        return jdbc.query(
                "SELECT observation FROM input_results WHERE session_id=? AND status='accepted'"
                        + " ORDER BY sequence",
                (row, n) -> json.read(row.getString(1), Observation.class),
                id.toString());
    }

    public int inputCount(UUID id) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM input_results WHERE session_id=?",
                Integer.class,
                id.toString());
    }

    public void queue(
            Stored session, String kind, String digest, UUID baseline, Observation observation) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "INSERT INTO"
                                + " input_results(session_id,sequence,kind,fingerprint,observation,status)"
                                + " VALUES(?,?,?,?,?,'pending')",
                            session.id().toString(),
                            observation.sequence(),
                            kind,
                            digest,
                            json.write(observation));
                    jdbc.update(
                            "INSERT INTO cep_outbox(session_id,sequence) VALUES(?,?)",
                            session.id().toString(),
                            observation.sequence());
                    if (baseline != null)
                        jdbc.update(
                                "UPDATE measurement_sessions SET baseline_id=?,model_version=?"
                                        + " WHERE id=?",
                                baseline.toString(),
                                observation.modelVersion(),
                                session.id().toString());
                });
    }

    public void confirm(Stored old, Input input, SessionView view) {
        requireProgress(old.view(), view);
        tx.executeWithoutResult(
                status -> {
                    saveSnapshot(old, view);
                    jdbc.update(
                            "UPDATE input_results SET status='accepted' WHERE session_id=? AND"
                                    + " sequence=? AND status='pending'",
                            old.id().toString(),
                            input.observation().sequence());
                    jdbc.update(
                            "UPDATE cep_outbox SET completed=TRUE WHERE session_id=? AND"
                                    + " sequence=?",
                            old.id().toString(),
                            input.observation().sequence());
                });
    }

    public void reject(UUID id, Input input, int statusCode) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "UPDATE input_results SET status='rejected',rejection_status=? WHERE"
                                    + " session_id=? AND sequence=?",
                            statusCode,
                            id.toString(),
                            input.observation().sequence());
                    jdbc.update(
                            "UPDATE cep_outbox SET completed=TRUE WHERE session_id=? AND"
                                    + " sequence=?",
                            id.toString(),
                            input.observation().sequence());
                });
    }

    public void queueEnd(UUID id, long at) {
        jdbc.update(
                "UPDATE measurement_sessions SET end_ms=? WHERE id=? AND end_ms IS NULL",
                at,
                id.toString());
    }

    public void confirmEnd(Stored old, SessionView view) {
        requireProgress(old.view(), view);
        tx.executeWithoutResult(
                status -> {
                    saveSnapshot(old, view);
                    jdbc.update(
                            "UPDATE measurement_sessions SET"
                                + " ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP(6)) WHERE id=?",
                            old.id().toString());
                    jdbc.update(
                            "INSERT IGNORE INTO cep_cleanup(session_id) VALUES(?)",
                            old.id().toString());
                });
    }

    public void delete(UUID owner, UUID id) {
        require(owner, id);
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "INSERT IGNORE INTO cep_cleanup(session_id) VALUES(?)", id.toString());
                    jdbc.update(
                            "DELETE FROM records WHERE user_id=? AND record_id=?",
                            owner.toString(),
                            id.toString());
                    jdbc.update(
                            "DELETE FROM measurement_sessions WHERE id=? AND user_id=?",
                            id.toString(),
                            owner.toString());
                });
    }

    public List<UUID> recoveryCandidates() {
        return jdbc.query(
                "SELECT s.id FROM measurement_sessions s WHERE EXISTS(SELECT 1 FROM cep_outbox o"
                    + " WHERE o.session_id=s.id AND o.completed=FALSE) OR (s.end_ms IS NOT NULL AND"
                    + " s.ended_at IS NULL) ORDER BY s.recovery_attempted_at IS NOT"
                    + " NULL,s.recovery_attempted_at,s.started_at,s.id LIMIT 32",
                (row, n) -> UUID.fromString(row.getString(1)));
    }

    public List<UUID> cleanupCandidates() {
        return jdbc.query(
                "SELECT session_id FROM cep_cleanup ORDER BY attempted_at IS NOT"
                        + " NULL,attempted_at,created_at,session_id LIMIT 32",
                (row, n) -> UUID.fromString(row.getString(1)));
    }

    public void cleanupComplete(UUID id) {
        jdbc.update("DELETE FROM cep_cleanup WHERE session_id=?", id.toString());
    }

    public void markRecoveryAttempt(UUID id) {
        jdbc.update(
                "UPDATE measurement_sessions SET recovery_attempted_at=CURRENT_TIMESTAMP(6) WHERE"
                        + " id=?",
                id.toString());
    }

    public void markCleanupAttempt(UUID id) {
        jdbc.update(
                "UPDATE cep_cleanup SET attempted_at=CURRENT_TIMESTAMP(6) WHERE session_id=?",
                id.toString());
    }

    public boolean wasConfirmed(UUID id, SessionView view) {
        var rows =
                jdbc.query(
                        "SELECT payload FROM confirmed_snapshots WHERE session_id=? AND"
                                + " fingerprint=?",
                        (row, n) -> row.getString(1),
                        id.toString(),
                        json.fingerprint(json.tree(view)));
        if (rows.isEmpty()) return false;
        String payload = rows.getFirst();
        if (json.read(payload, JsonNode.class).has("proof_version"))
            return json.read(payload, SnapshotProof.class).equals(SnapshotProof.of(view));
        // Earlier deployments stored the complete view in this same column.
        return json.read(payload, SessionView.class).equals(view);
    }

    private void saveSnapshot(Stored old, SessionView view) {
        UUID id = old.id();
        jdbc.update(
                "UPDATE measurement_sessions SET snapshot=? WHERE id=?",
                json.write(view),
                id.toString());
        rememberSnapshot(id, view);
        // requireProgress already checked the complete immutable prefix against the saved view.
        for (var event : view.events().subList(old.view().events().size(), view.events().size())) {
            var rows =
                    jdbc.query(
                            "SELECT payload FROM session_events WHERE session_id=? AND event_id=?",
                            (row, n) -> json.read(row.getString(1), DecisionEvent.class),
                            id.toString(),
                            event.eventId());
            if (!rows.isEmpty() && !rows.getFirst().equals(event))
                throw new ContractError(502, "CEP changed a confirmed event");
            jdbc.update(
                    "INSERT IGNORE INTO session_events(session_id,event_id,payload) VALUES(?,?,?)",
                    id.toString(),
                    event.eventId(),
                    json.write(event));
        }
    }

    private void rememberSnapshot(UUID id, SessionView view) {
        jdbc.update(
                "INSERT IGNORE INTO confirmed_snapshots(session_id,fingerprint,payload)"
                        + " VALUES(?,?,?)",
                id.toString(),
                json.fingerprint(json.tree(view)),
                json.write(SnapshotProof.of(view)));
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

    private Stored session(ResultSet row, int n) throws SQLException {
        String baseline = row.getString("baseline_id");
        Long end = row.getObject("end_ms", Long.class);
        var ended = row.getTimestamp("ended_at");
        return new Stored(
                UUID.fromString(row.getString("id")),
                UUID.fromString(row.getString("user_id")),
                json.read(row.getString("policy"), Policy.class),
                json.read(row.getString("snapshot"), SessionView.class),
                baseline == null ? null : UUID.fromString(baseline),
                row.getString("model_version"),
                end,
                row.getTimestamp("started_at").toInstant(),
                ended == null ? null : ended.toInstant());
    }

    private Input input(ResultSet row, int n) throws SQLException {
        return new Input(
                row.getString("kind"),
                row.getString("fingerprint"),
                json.read(row.getString("observation"), Observation.class),
                row.getString("status"),
                row.getInt("rejection_status"));
    }

    public record Stored(
            UUID id,
            UUID owner,
            Policy policy,
            SessionView view,
            UUID baseline,
            String modelVersion,
            Long endMs,
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
