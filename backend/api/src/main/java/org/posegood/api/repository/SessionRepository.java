package org.posegood.api.repository;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Development in-memory snapshot storage; the application service owns request coordination. */
@Repository
@Profile("!persistent")
public class SessionRepository {
    private final Map<UUID, StoredSession> sessions = new ConcurrentHashMap<>();

    public StoredSession find(UUID id) {
        return sessions.get(id);
    }

    public StoredSession require(UUID id) {
        var stored = find(id);
        if (stored == null) {
            throw new ContractError(404, "session not found");
        }
        return stored;
    }

    public int size() {
        return sessions.size();
    }

    public void saveNew(UUID id, SessionView view) {
        sessions.put(id, new StoredSession(view));
    }

    /** The service holds this monitor across inference, CEP, and snapshot replacement. */
    public static final class StoredSession {
        private SessionView view;
        private UUID featureBaselineId;
        private final Map<Long, FeatureResult> featureResults = new HashMap<>();
        private FeatureResult pendingFeature;

        private StoredSession(SessionView view) {
            this.view = view;
        }

        public SessionView view() {
            return view;
        }

        public void replace(SessionView view) {
            this.view = view;
        }

        public UUID featureBaselineId() {
            return featureBaselineId;
        }

        public FeatureResult featureResult(long sequence) {
            return featureResults.get(sequence);
        }

        public int featureResultCount() {
            return featureResults.size();
        }

        public FeatureResult pendingFeature() {
            return pendingFeature;
        }

        /** Retains output and a retry digest, never the request's feature values. */
        public void cacheFeature(UUID baselineId, String fingerprint, Observation observation) {
            featureBaselineId = baselineId;
            pendingFeature = new FeatureResult(fingerprint, observation, 0);
            featureResults.put(observation.sequence(), pendingFeature);
        }

        public void clearPendingFeature() {
            pendingFeature = null;
        }

        public void rejectPendingFeature(int status) {
            var rejected =
                    new FeatureResult(
                            pendingFeature.fingerprint(), pendingFeature.observation(), status);
            featureResults.put(pendingFeature.observation().sequence(), rejected);
            pendingFeature = null;
        }
    }

    public record FeatureResult(String fingerprint, Observation observation, int rejectionStatus) {}
}
