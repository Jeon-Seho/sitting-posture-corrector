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
 * 설정과 기록 처리 서비스.
 *
 * 설정은 `user_account`와 바뀌지 않는 `threshold_policy` 행에 있다. 앱 기록 원문은 저장하지 않는다
 * (V2.1에서 `client_record` 삭제): 저장은 서버 판정과 대조하고 세션 행을 닫으며, 조회는
 * 세션 테이블에서 다시 만든다({@link RecordHistory}).
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

    /**
     * 설정 + 기록 조회.
     *
     * {@code alerts_on} is the 「자세 알림」 switch, `user_account.alert_enabled` (V2.2).
     */
    public ObjectNode get(long owner) {
        var account = accounts.requireActive(owner);
        var policy = policies.read(account.policyId());
        ObjectNode result = (ObjectNode) json.tree(Map.of("schema_version", "1.0", "profile", account.profile()));
        result.set("rules", RecordRebuild.rules(policy));
        result.putObject("preferences").put("alerts_on", account.alertsEnabled());
        result.set("records", json.tree(records(owner)));
        return result;
    }

    /**
     * 설정 저장: 프로필, 판정 기준, 자세 알림.
     *
     * {@code PUT /v1/workspace}는 {profile, rules, preferences} 전체를 받는다. 기록은 바꾸지 않는다.
     */
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

    /** 기록 목록(세션 테이블에서 다시 만듦). */
    public List<JsonNode> records(long owner) {
        return history.list(owner);
    }

    /**
     * 기록 저장: 서버 판정과 대조한 뒤 세션 행을 닫는다.
     *
     * 서버 측정 기록만 받는다. 검증({@link ServerRecordVerifier}) 뒤 세션 행이 열려 있으면 닫고,
     * 보낸 기록을 날짜만 DB 시각으로 바꿔 돌려준다.
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

    /**
     * 기록 삭제 = 그 세션 삭제.
     */
    public void deleteRecord(long owner, String id) {
        UUID session;
        try {
            session = UUID.fromString(id);
        } catch (IllegalArgumentException local) {
            return; // 로컬 기록 ID는 세션 UUID가 아닐 수 있고, 서버에 저장된 것도 없다.
        }
        try {
            sessions.delete(owner, session);
        } catch (ApiError missing) {
            if (missing.status() != 404) throw missing;
        }
    }
}
