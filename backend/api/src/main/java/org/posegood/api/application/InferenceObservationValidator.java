package org.posegood.api.application;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;

final class InferenceObservationValidator {
    private InferenceObservationValidator() {}

    static void require(InferenceRequest request, Observation observation) {
        if (observation == null
                || !"2.0".equals(observation.schemaVersion())
                || observation.sequence() != request.sequence()
                || observation.startMs() != request.startMs()
                || observation.endMs() != request.endMs()
                || observation.phase() != request.phase()
                || !Double.isFinite(observation.collapseProbability())
                || observation.collapseProbability() < 0
                || observation.collapseProbability() > 1
                || observation.deviationType() == null
                || !"reference-feature-rule-v1".equals(observation.modelVersion())
                || (!observation.valid()
                        && (observation.collapseProbability() != 0
                                || observation.deviationType() != Observation.DeviationType.none))
                || (observation.valid()
                        && (request.phase() != Observation.Phase.running
                                || request.measurementQuality()
                                        != InferenceRequest.MeasurementQuality.good
                                || request.features() == null
                                || request.features().currentQuality() < 0.65
                                || request.features().baselineQuality() < 0.65)))
            throw new ContractError(502, "inference response contract mismatch");
    }
}
