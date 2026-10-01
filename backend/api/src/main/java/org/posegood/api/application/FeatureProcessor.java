package org.posegood.api.application;

import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.api.repository.SessionRepository.StoredSession;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.FeatureResponse;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;

import java.util.UUID;

/** Called only while the application service holds the stored session's monitor. */
final class FeatureProcessor {
    private static final int MAX_FEATURE_REQUESTS = 10_000;

    private final CepGateway cep;
    private final InferenceGateway inference;

    FeatureProcessor(CepGateway cep, InferenceGateway inference) {
        this.cep = cep;
        this.inference = inference;
    }

    FeatureResponse process(UUID id, StoredSession stored, InferenceRequest request) {
        String fingerprint = FeatureRequestFingerprint.of(request);
        var cached = stored.featureResult(request.sequence());
        if (cached != null) {
            if (!cached.fingerprint().equals(fingerprint)) {
                throw new ContractError(409, "conflicting feature duplicate");
            }
            if (cached.rejectionStatus() != 0) {
                throw new ContractError(cached.rejectionStatus(), "CEP rejected feature request");
            }
            if (cached == stored.pendingFeature()) {
                flushPending(id, stored);
            }
            return new FeatureResponse("1.0", cached.observation(), stored.view());
        }

        requireNewRequest(stored, request);
        var observation = inference.infer(request);
        requireObservation(request, observation);
        // Freeze after inference succeeds; uncertain CEP failures retain this exact output.
        stored.cacheFeature(request.baselineId(), fingerprint, observation);
        flushPending(id, stored);
        return new FeatureResponse("1.0", observation, stored.view());
    }

    private void flushPending(UUID id, StoredSession stored) {
        var pending = stored.pendingFeature();
        if (pending == null) {
            return;
        }
        SessionView result;
        try {
            result = cep.observe(id, pending.observation());
        } catch (ContractError error) {
            if (error.status() == 409 || error.status() == 429) {
                // A definite refusal cannot be resolved by retrying, so allow termination.
                stored.rejectPendingFeature(error.status());
            }
            throw error;
        }
        CepSnapshotValidator.requireIdentity(id, stored.view().policy(), result);
        if (result.lastSequence() < pending.observation().sequence()
                || result.summary().totalMs() < pending.observation().endMs()) {
            throw new ContractError(502, "CEP response did not acknowledge pending observation");
        }
        stored.replace(result);
        stored.clearPendingFeature();
    }

    private void requireNewRequest(StoredSession stored, InferenceRequest request) {
        var view = stored.view();
        if (view.ended()) {
            throw new ContractError(409, "session ended");
        }
        if (stored.pendingFeature() != null) {
            throw new ContractError(409, "retry pending feature request first");
        }
        if (stored.featureBaselineId() != null
                && !stored.featureBaselineId().equals(request.baselineId())) {
            throw new ContractError(409, "baseline already frozen");
        }
        if (request.sequence() <= view.lastSequence()
                || request.startMs() < view.summary().totalMs()) {
            throw new ContractError(409, "out-of-order or overlapping interval");
        }
        if (stored.featureResultCount() >= MAX_FEATURE_REQUESTS) {
            throw new ContractError(429, "development observation limit reached");
        }
    }

    private void requireObservation(InferenceRequest request, Observation observation) {
        InferenceObservationValidator.require(request, observation);
    }
}
