package org.posegood.api.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.api.account.AccountContracts;
import org.posegood.api.account.AccountRepository;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.posegood.api.session.SessionService;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Settings live in `user_account` and its immutable `threshold_policy` row. App records are not
 * stored as sent (schema V2.1 dropped `client_record`): saving one checks it against the session
 * the server decided and closes that session's row; reading rebuilds records from the session
 * tables ({@link RecordHistory}).
 */
@Service
public class WorkspaceService {
    private final Json json;
    private final AccountService accounts;
    private final AccountRepository accountRows;
    private final ThresholdPolicyRepository policies;
    private final SessionService sessions;
    private final ServerRecordVerifier verifier;
    private final RecordHistory history;
    private final UserLocks locks;

    public WorkspaceService(
            Json json,
            AccountService accounts,
            AccountRepository accountRows,
            ThresholdPolicyRepository policies,
            SessionService sessions,
            ServerRecordVerifier verifier,
            RecordHistory history,
            UserLocks locks) {
        this.json = json;
        this.accounts = accounts;
        this.accountRows = accountRows;
        this.policies = policies;
        this.sessions = sessions;
        this.verifier = verifier;
        this.history = history;
        this.locks = locks;
    }

    /** {@code alerts_on} is the 「자세 알림」 switch, `user_account.alert_enabled` (V2.2). */
    public ObjectNode get(long owner) {
        var account = accounts.requireActive(owner);
        var policy = policies.read(account.policyId());
        ObjectNode result = (ObjectNode) json.tree(Map.of("schema_version", "1.0", "profile", account.profile()));
        result.set("rules", RecordRebuild.rules(policy));
        result.putObject("preferences").put("alerts_on", account.alertsEnabled());
        result.set("records", json.tree(records(owner)));
        return result;
    }

    /** {@code PUT /v1/workspace} takes the whole {profile, rules, preferences}; records stay. */
    public ObjectNode update(long owner, JsonNode body) {
        RecordValidator.shape(body, Set.of("profile", "rules", "preferences"), Set.of());
        RecordValidator.rules(body.get("rules"));
        RecordValidator.preferences(body.get("preferences"));
        RecordValidator.shape(body.get("profile"), Set.of("name", "age", "occupation"), Set.of());
        var rules = body.get("rules");
        var values =
                ThresholdPolicyRepository.Values.ofSeconds(
                        rules.get("holdSeconds").asDouble(),
                        rules.get("recoverSeconds").asDouble(),
                        rules.get("realertSeconds").asDouble(),
                        rules.get("threshold").asDouble());
        var profile = json.convert(body.get("profile"), AccountContracts.Profile.class);
        if (profile.name() == null
                || profile.name().isBlank()
                || profile.name().length() > 30
                || profile.age() < 1
                || profile.age() > 120
                || profile.occupation() == null
                || profile.occupation().isBlank()
                || profile.occupation().length() > 80) RecordValidator.invalid();
        boolean alerts = body.get("preferences").get("alerts_on").asBoolean();
        locks.run(
                owner,
                () -> {
                    accounts.requireActive(owner);
                    accountRows.updateSettings(owner, profile, policies.resolve(values), alerts);
                });
        return get(owner);
    }

    public List<JsonNode> records(long owner) {
        return history.list(owner);
    }

    /**
     * Only server session records are kept. The record must match what this server decided
     * ({@link ServerRecordVerifier}); its session row is then closed if it was still open, and the
     * record is answered as sent with the stored session times.
     */
    public JsonNode save(long owner, JsonNode body) {
        RecordValidator.record(body);
        if (!body.has("server")) throw ApiError.badRequest("only server session records are stored");
        ObjectNode canonical = body.deepCopy();
        verifier.verify(owner, canonical);
        var view = body.get("server").get("view");
        long acknowledged = view.isNull() ? 0 : view.get("summary").get("total_ms").asLong();
        sessions.closeForRecord(owner, UUID.fromString(body.get("id").asText()), acknowledged);
        return canonical;
    }

    /** A server record is its session: deleting it deletes the session and its decisions. */
    public void deleteRecord(long owner, String id) {
        UUID session;
        try {
            session = UUID.fromString(id);
        } catch (IllegalArgumentException local) {
            return; // A local record id need not be a session UUID; nothing is stored for it.
        }
        try {
            sessions.delete(owner, session);
        } catch (ApiError missing) {
            if (missing.status() != 404) throw missing;
        }
    }
}
