package org.posegood.api.application;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.Policy;
import org.posegood.contracts.SessionView;

import java.util.UUID;

final class CepSnapshotValidator {
    private CepSnapshotValidator() {}

    static void requireIdentity(UUID id, Policy policy, SessionView view) {
        if (view == null
                || !id.equals(view.sessionId())
                || !policy.equals(view.policy())
                || !"1.0".equals(view.schemaVersion())
                || !"legacy-interrupt-v1".equals(view.timerPolicy())
                || view.summary() == null
                || view.events() == null
                || view.events().stream()
                        .anyMatch(event -> event == null || !id.equals(event.sessionId()))) {
            throw new ContractError(502, "CEP response contract mismatch");
        }
    }
}
