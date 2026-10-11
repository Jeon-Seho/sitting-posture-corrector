package org.posegood.api.workspace;

import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.SessionView;
import org.posegood.api.session.LiveSessions;
import org.posegood.api.session.SessionRepository;
import org.posegood.api.session.SessionService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.UUID;

/**
 * A record that claims server results must match what this server decided for the owner's session.
 * With live state the view must be a prefix of the engine's history (and equal it once confirmed).
 * After a restart only the stored facts can be compared: the end, good time and episode counts.
 */
@Component
class ServerRecordVerifier {
    private final SessionService sessions;
    private final LiveSessions live;
    private final Json json;

    ServerRecordVerifier(SessionService sessions, LiveSessions live, Json json) {
        this.sessions = sessions;
        this.live = live;
        this.json = json;
    }

    /** Validates and normalizes the record's dates to the stored session times. */
    void verify(long owner, ObjectNode body) {
        var id = UUID.fromString(body.get("id").asText());
        var stored = sessions.owned(owner, id);
        var server = body.get("server");
        boolean confirmed = server.get("confirmed").asBoolean();
        if (!stored.baselineId().equals(UUID.fromString(server.get("baselineId").asText())))
            throw ApiError.conflict("record baseline mismatch");
        var raw = server.get("view");
        if (raw.isNull()) {
            if (confirmed
                    || body.get("total").asDouble() != 0
                    || body.get("valid").asDouble() != 0
                    || body.get("good").asDouble() != 0
                    || !body.get("events").isEmpty()) RecordValidator.invalid();
            if (!"unmeasured".equals(server.get("modelVersion").asText()))
                throw ApiError.conflict("record model mismatch");
        } else {
            var view = json.convert(raw, SessionView.class);
            if (!id.equals(view.sessionId()) || (confirmed && !view.ended()))
                throw ApiError.conflict("record snapshot was not acknowledged");
            acknowledged(stored, view, confirmed);
            String model = view.lastSequence() < 0 ? "unmeasured" : sessions.modelVersion();
            if (!model.equals(server.get("modelVersion").asText()))
                throw ApiError.conflict("record model mismatch");
            var summary = view.summary();
            if (body.get("total").asDouble() != summary.totalMs() / 1000.0
                    || body.get("valid").asDouble() != summary.validMs() / 1000.0
                    || body.get("good").asDouble() != summary.normalMs() / 1000.0)
                throw ApiError.conflict("record totals mismatch");
            if (!RecordProjection.same(body.get("events"), RecordProjection.events(view, confirmed)))
                throw ApiError.conflict("record events mismatch");
            var rules = body.get("rules");
            var policy = view.policy();
            if (rules.get("holdSeconds").asDouble() * 1000 != policy.holdMs()
                    || rules.get("recoverSeconds").asDouble() * 1000 != policy.recoveryMs()
                    || rules.get("realertSeconds").asDouble() * 1000 != policy.reminderMs()
                    || rules.get("threshold").asDouble() != policy.threshold())
                throw ApiError.conflict("record policy mismatch");
        }
        body.put("startedAt", stored.startedAt().toString());
        if (confirmed && stored.endedAt() != null) body.put("endedAt", stored.endedAt().toString());
        else if (Instant.parse(body.get("endedAt").asText()).isBefore(stored.startedAt()))
            body.put("endedAt", stored.startedAt().toString());
    }

    private void acknowledged(SessionRepository.Stored stored, SessionView view, boolean confirmed) {
        if (!stored.policy().equals(view.policy())) throw notAcknowledged();
        var session = live.get(stored.id());
        if (session != null) {
            var current = session.locked(() -> session.engine().view());
            boolean prefix =
                    view.lastSequence() <= current.lastSequence()
                            && view.events().size() <= current.events().size()
                            && view.events().equals(current.events().subList(0, view.events().size()))
                            && view.summary().totalMs() <= current.summary().totalMs();
            if (!prefix || ((confirmed || view.ended()) && !view.equals(current))) throw notAcknowledged();
            return;
        }
        var summary = view.summary();
        if (confirmed) {
            boolean same =
                    stored.endedAt() != null
                            && stored.goodSec() != null
                            && stored.goodSec()
                                            .compareTo(
                                                    BigDecimal.valueOf(summary.normalMs(), 3)
                                                            .setScale(1, RoundingMode.DOWN))
                                    == 0
                            && stored.collapseCount() == summary.collapseCount()
                            && stored.alertCount() == summary.alertCount();
            if (!same) throw notAcknowledged();
        } else if (summary.collapseCount() > stored.collapseCount()
                || summary.alertCount() > stored.alertCount()) throw notAcknowledged();
    }

    private static ApiError notAcknowledged() {
        return ApiError.conflict("record snapshot was not acknowledged");
    }
}
