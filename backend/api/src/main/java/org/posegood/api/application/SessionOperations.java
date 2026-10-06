package org.posegood.api.application;

import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.FeatureResponse;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;

import java.util.UUID;

public interface SessionOperations {
    /** {@code setup} is required by the persistent mode and ignored by the memory mode. */
    SessionView create(UUID id, CreateSession request, SessionSetup setup);

    SessionView observe(UUID id, Observation observation);

    FeatureResponse features(UUID id, InferenceRequest request);

    SessionView end(UUID id, EndSession request);

    SessionView get(UUID id);
}
