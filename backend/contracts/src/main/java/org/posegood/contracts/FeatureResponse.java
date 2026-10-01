package org.posegood.contracts;

/** New feature-flow envelope; existing observation v2 and session view v1 remain unchanged. */
public record FeatureResponse(String schemaVersion, Observation observation, SessionView session) {}
