package org.posegood.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.api.account.AccountContracts;
import org.posegood.api.account.UserStore;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.SessionView;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Repository
@Profile("persistent")
public class JdbcWorkspaceStore {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final UserStore users;
    private final JdbcSessionStore sessions;
    private final TransactionTemplate tx;

    public JdbcWorkspaceStore(
            JdbcTemplate jdbc,
            JsonCodec json,
            UserStore users,
            JdbcSessionStore sessions,
            TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.json = json;
        this.users = users;
        this.sessions = sessions;
        this.tx = tx;
    }

    public ObjectNode get(UUID owner) {
        var user = users.require(owner);
        var settings =
                jdbc.queryForMap(
                        "SELECT rules,preferences FROM workspaces WHERE user_id=?",
                        owner.toString());
        ObjectNode result =
                (ObjectNode)
                        json.tree(
                                java.util.Map.of(
                                        "schema_version", "1.0", "profile", user.profile()));
        result.set("rules", json.read(settings.get("rules").toString(), JsonNode.class));
        result.set(
                "preferences", json.read(settings.get("preferences").toString(), JsonNode.class));
        result.set("records", json.tree(records(owner)));
        return result;
    }

    public ObjectNode update(UUID owner, JsonNode body) {
        WorkspaceValidator.shape(body, Set.of("profile", "rules", "preferences"), Set.of());
        WorkspaceValidator.rules(body.get("rules"));
        WorkspaceValidator.preferences(body.get("preferences"));
        WorkspaceValidator.shape(
                body.get("profile"), Set.of("name", "age", "occupation"), Set.of());
        var profile = json.readInput(body.get("profile"), AccountContracts.Profile.class);
        if (profile.name() == null
                || profile.name().isBlank()
                || profile.name().length() > 50
                || profile.age() < 1
                || profile.age() > 120
                || profile.occupation() == null
                || profile.occupation().isBlank()
                || profile.occupation().length() > 80) WorkspaceValidator.invalid();
        tx.executeWithoutResult(
                status -> {
                    users.updateProfile(owner, profile);
                    jdbc.update(
                            "UPDATE workspaces SET rules=?,preferences=? WHERE user_id=?",
                            json.write(body.get("rules")),
                            json.write(body.get("preferences")),
                            owner.toString());
                });
        return get(owner);
    }

    public List<JsonNode> records(UUID owner) {
        return jdbc.query(
                "SELECT payload FROM records WHERE user_id=? ORDER BY created_at DESC,record_id",
                (row, n) -> json.read(row.getString(1), JsonNode.class),
                owner.toString());
    }

    public JsonNode save(UUID owner, JsonNode body) {
        WorkspaceValidator.record(body);
        String id = body.get("id").asText(), digest = json.fingerprint(body);
        var existing =
                jdbc.query(
                        "SELECT fingerprint,payload FROM records WHERE user_id=? AND record_id=?",
                        (row, n) ->
                                new Existing(
                                        row.getString(1),
                                        json.read(row.getString(2), JsonNode.class)),
                        owner.toString(),
                        id);
        if (!existing.isEmpty()) {
            if (!existing.getFirst().digest().equals(digest))
                throw new ContractError(409, "conflicting record duplicate");
            return existing.getFirst().value();
        }
        ObjectNode canonical = body.deepCopy();
        if (body.has("server")) validateServer(owner, canonical);
        jdbc.update(
                "INSERT INTO records(user_id,record_id,fingerprint,payload) VALUES(?,?,?,?)",
                owner.toString(),
                id,
                digest,
                json.write(canonical));
        return canonical;
    }

    public void deleteRecord(UUID owner, String id) {
        jdbc.update("DELETE FROM records WHERE user_id=? AND record_id=?", owner.toString(), id);
        try {
            var uuid = UUID.fromString(id);
            var session = sessions.find(uuid);
            if (session != null && session.owner().equals(owner)) sessions.delete(owner, uuid);
        } catch (IllegalArgumentException ignored) {
            /* A local record id need not be a server UUID. */
        }
    }

    private void validateServer(UUID owner, ObjectNode body) {
        UUID id;
        try {
            id = UUID.fromString(body.get("id").asText());
        } catch (IllegalArgumentException invalid) {
            WorkspaceValidator.invalid();
            return;
        }
        var stored = sessions.require(owner, id);
        var server = body.get("server");
        boolean confirmed = server.get("confirmed").asBoolean();
        var raw = server.get("view");
        UUID baseline = UUID.fromString(server.get("baselineId").asText());
        if (stored.baseline() != null && !stored.baseline().equals(baseline))
            throw new ContractError(409, "record baseline mismatch");
        if (raw.isNull()) {
            if (confirmed
                    || body.get("total").asDouble() != 0
                    || body.get("valid").asDouble() != 0
                    || body.get("good").asDouble() != 0
                    || body.get("events").size() != 0) WorkspaceValidator.invalid();
            if (!"unmeasured".equals(server.get("modelVersion").asText()))
                throw new ContractError(409, "record model mismatch");
        } else {
            var view = json.readInput(raw, SessionView.class);
            if (!id.equals(view.sessionId())
                    || !sessions.wasConfirmed(id, view)
                    || (confirmed && !view.ended()))
                throw new ContractError(409, "record snapshot was not acknowledged");
            var original = view.lastSequence() < 0 ? null : sessions.input(id, view.lastSequence());
            String acknowledgedModel =
                    original == null ? "unmeasured" : original.observation().modelVersion();
            if (!acknowledgedModel.equals(server.get("modelVersion").asText()))
                throw new ContractError(409, "record model mismatch");
            if (body.get("total").asDouble() != view.summary().totalMs() / 1000.0
                    || body.get("valid").asDouble() != view.summary().validMs() / 1000.0
                    || body.get("good").asDouble() != view.summary().normalMs() / 1000.0)
                throw new ContractError(409, "record totals mismatch");
            if (!ServerRecordProjection.same(
                    body.get("events"), ServerRecordProjection.events(view, confirmed)))
                throw new ContractError(409, "record events mismatch");
            var rules = body.get("rules");
            var policy = view.policy();
            if (rules.get("holdSeconds").asDouble() * 1000 != policy.holdMs()
                    || rules.get("recoverSeconds").asDouble() * 1000 != policy.recoveryMs()
                    || rules.get("realertSeconds").asDouble() * 1000 != policy.reminderMs()
                    || rules.get("threshold").asDouble() != policy.threshold())
                throw new ContractError(409, "record policy mismatch");
        }
        body.put("startedAt", stored.startedAt().toString());
        if (confirmed && stored.endedAt() != null) body.put("endedAt", stored.endedAt().toString());
        else if (java.time.Instant.parse(body.get("endedAt").asText()).isBefore(stored.startedAt()))
            body.put("endedAt", stored.startedAt().toString());
    }

    private record Existing(String digest, JsonNode value) {}
}
