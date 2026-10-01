package org.posegood.api.gateway;

import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;

public interface InferenceGateway {
    Observation infer(InferenceRequest request);
}
