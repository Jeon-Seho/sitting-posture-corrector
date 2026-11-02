package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FeatureDeltas;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.springframework.web.client.RestClient;

/**
 * 추론 응답 검증 시험.
 *
 * 합성 요청·출력만 쓴다.
 */
class InferenceClientTest {
	private static final String MODEL = "reference-feature-rule-v1";
	private final InferenceClient client = new InferenceClient(RestClient.builder(), "http://127.0.0.1:9", false, "",
		MODEL);

	private static InferenceRequest request(double quality, InferenceRequest.MeasurementQuality measured) {
		return new InferenceRequest(
			"2.0",
			"shoulder-relative-deltas-v1",
			UUID.fromString("00000000-0000-4000-8000-000000000001"),
			0,
			0,
			1000,
			Observation.Phase.running,
			measured,
			new FeatureDeltas(0.3, 0, 0, quality, 0.9));
	}

	private static Observation output(boolean valid, double score, Observation.DeviationType type, String model) {
		return new Observation("2.0", 0, 0, 1000, Observation.Phase.running, valid, score, type, model);
	}

	@Test
	void acceptsAMatchingValidOutput() {
		assertDoesNotThrow(
			() -> client.require(
				request(0.9, InferenceRequest.MeasurementQuality.good),
				output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
	}

	@Test
	void lowQualityMustNeverBecomeValidTime() {
		var error = assertThrows(
			ApiError.class,
			() -> client.require(
				request(0.6, InferenceRequest.MeasurementQuality.good),
				output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
		assertEquals(502, error.status());
		assertThrows(
			ApiError.class,
			() -> client.require(
				request(0.9, InferenceRequest.MeasurementQuality.poor),
				output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
	}

	@Test
	void invalidOutputMustHaveZeroScoreAndNoType() {
		assertThrows(
			ApiError.class,
			() -> client.require(
				request(0.6, InferenceRequest.MeasurementQuality.good),
				output(false, 0.4, Observation.DeviationType.none, MODEL)));
		assertDoesNotThrow(
			() -> client.require(
				request(0.6, InferenceRequest.MeasurementQuality.good),
				output(false, 0, Observation.DeviationType.none, MODEL)));
	}

	@Test
	void anotherModelOrIntervalIsRejected() {
		assertThrows(
			ApiError.class,
			() -> client.require(
				request(0.9, InferenceRequest.MeasurementQuality.good),
				output(true, 0.95, Observation.DeviationType.unspecified, "other-model")));
		var shifted = new Observation(
			"2.0", 0, 1, 1000, Observation.Phase.running, true, 0.9,
			Observation.DeviationType.unspecified, MODEL);
		assertThrows(
			ApiError.class,
			() -> client.require(request(0.9, InferenceRequest.MeasurementQuality.good), shifted));
	}

	@Test
	void endpointMustBeLoopbackOrTokenProtectedInternalHost() {
		assertDoesNotThrow(() -> InferenceClient.requireEndpoint("http://127.0.0.1:8092", false, ""));
		assertThrows(
			IllegalArgumentException.class,
			() -> InferenceClient.requireEndpoint("http://example.com:8092", false, ""));
		assertThrows(
			IllegalArgumentException.class,
			() -> InferenceClient.requireEndpoint("http://inference:8092", false, ""));
		assertThrows(
			IllegalArgumentException.class,
			() -> InferenceClient.requireEndpoint("http://inference:8092", true, "short"));
		assertDoesNotThrow(
			() -> InferenceClient.requireEndpoint("http://inference:8092", true, "a".repeat(32)));
		assertThrows(
			IllegalArgumentException.class,
			() -> InferenceClient.requireEndpoint("http://127.0.0.1:8092/path", false, ""));
	}
}
