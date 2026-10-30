package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FeatureDeltas;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.springframework.web.client.RestClient;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * 추론 응답 검증 시험.
 *
 * 합성 요청·출력만 쓴다.
 */
class InferenceClientTest {
    private static final String MODEL = "reference-feature-rule-v1";
    private final InferenceClient client =
            new InferenceClient(RestClient.builder(), "http://127.0.0.1:9", false, "", MODEL);

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
                () ->
                        client.require(
                                request(0.9, InferenceRequest.MeasurementQuality.good),
                                output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
    }

    @Test
    void lowQualityMustNeverBecomeValidTime() {
        var error =
                assertThrows(
                        ApiError.class,
                        () ->
                                client.require(
                                        request(0.6, InferenceRequest.MeasurementQuality.good),
                                        output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
        assertEquals(502, error.status());
        assertThrows(
                ApiError.class,
                () ->
                        client.require(
                                request(0.9, InferenceRequest.MeasurementQuality.poor),
                                output(true, 0.95, Observation.DeviationType.unspecified, MODEL)));
    }

    @Test
    void invalidOutputMustHaveZeroScoreAndNoType() {
        assertThrows(
                ApiError.class,
                () ->
                        client.require(
                                request(0.6, InferenceRequest.MeasurementQuality.good),
                                output(false, 0.4, Observation.DeviationType.none, MODEL)));
        assertDoesNotThrow(
                () ->
                        client.require(
                                request(0.6, InferenceRequest.MeasurementQuality.good),
                                output(false, 0, Observation.DeviationType.none, MODEL)));
    }

    @Test
    void anotherModelOrIntervalIsRejected() {
        assertThrows(
                ApiError.class,
                () ->
                        client.require(
                                request(0.9, InferenceRequest.MeasurementQuality.good),
                                output(true, 0.95, Observation.DeviationType.unspecified, "other-model")));
        var shifted =
                new Observation(
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

    // v3(계획 0064): 프레임마다 결과 하나, 같은 순서·같은 t_ms.

    private static FrameInference.Request frames() {
        var p = Collections.nCopies(9, List.of(0.5, 0.5, 0.9));
        return new FrameInference.Request("3.0", "keypoints-9-v1", Collections.nCopies(9, List.of(0.5, 0.5)),
                List.of(new FrameInference.Frame(0, p, null), new FrameInference.Frame(100, null, null),
                        new FrameInference.Frame(200, null, false)));
    }

    private static FrameInference.Result judged(long t) {
        return new FrameInference.Result(t, true, 0.9, Observation.DeviationType.left_lean, null);
    }

    private static FrameInference.Result unjudged(long t) {
        return new FrameInference.Result(t, false, 0, Observation.DeviationType.none, "unmeasurable");
    }

    private static FrameInference.Response response(String model, FrameInference.Result... results) {
        return new FrameInference.Response("3.0", model, List.of(results));
    }

    @Test
    void frameResultsMustMatchTheRequestFrames() {
        assertDoesNotThrow(() -> client.require(frames(), response(MODEL, judged(0), unjudged(100), unjudged(200))));
        // 개수·순서·t_ms·모델이 다르면 502.
        assertEquals(502, assertThrows(ApiError.class,
                () -> client.require(frames(), response(MODEL, judged(0), unjudged(100)))).status());
        assertThrows(ApiError.class,
                () -> client.require(frames(), response(MODEL, unjudged(100), judged(0), unjudged(200))));
        assertThrows(ApiError.class,
                () -> client.require(frames(), response("other-model", judged(0), unjudged(100), unjudged(200))));
    }

    @Test
    void untrackedFramesMustNeverBecomeJudgedTime() {
        // 사람 없음(p null)·앱의 판정 불가 표시(valid false)는 유효로 올 수 없다.
        assertThrows(ApiError.class,
                () -> client.require(frames(), response(MODEL, judged(0), judged(100), unjudged(200))));
        assertThrows(ApiError.class,
                () -> client.require(frames(), response(MODEL, judged(0), unjudged(100), judged(200))));
        // 판정 불가는 점수 0·종류 none·사유가 있어야 한다.
        var scored = new FrameInference.Result(100, false, 0.4, Observation.DeviationType.none, "unmeasurable");
        assertThrows(ApiError.class, () -> client.require(frames(), response(MODEL, judged(0), scored, unjudged(200))));
        var reasonless = new FrameInference.Result(100, false, 0, Observation.DeviationType.none, null);
        assertThrows(ApiError.class,
                () -> client.require(frames(), response(MODEL, judged(0), reasonless, unjudged(200))));
        var turned = new FrameInference.Result(100, false, 0, Observation.DeviationType.none, "head_turn");
        assertDoesNotThrow(() -> client.require(frames(), response(MODEL, judged(0), turned, unjudged(200))));
    }

    @Test
    void anUnreachableInferenceIsTriedTwiceThen502() {
        // 127.0.0.1:9(discard)에는 서버가 없다.
        assertEquals(502, assertThrows(ApiError.class, () -> client.infer(frames())).status());
    }
}
