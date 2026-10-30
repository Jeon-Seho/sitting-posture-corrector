package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;

/**
 * FastAPI 추론 호출과 결과 검증. 실패하거나 맞지 않으면 502.
 *
 * 실시간 판정은 v3({@code POST /v3/infer}, 프레임 묶음, 계획 0064)를 쓴다. v2({@code POST /v2/infer}, 구간 특징
 * 하나)는 Kafka 경로·비교 시험이 옮길 때까지 남긴다. 결과는 판정 엔진에 넣기 전에 요청과 대조한다. 맞지 않으면
 * 502이고 세션 상태는 바뀌지 않는다.
 */
@Component
public class InferenceClient {
    private final RestClient client;
    private final String modelVersion;

    public InferenceClient(
            RestClient.Builder builder,
            @Value("${posegood.inference-url}") String url,
            @Value("${posegood.internal-hosts-enabled:false}") boolean internal,
            @Value("${posegood.internal-token:}") String token,
            @Value("${posegood.model-version}") String modelVersion) {
        requireEndpoint(url, internal, token);
        var factory = new NoRedirectRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(3000);
        if (internal) builder.defaultHeader("X-PoseGood-Internal-Token", token);
        client = builder.baseUrl(url).requestFactory(factory).build();
        this.modelVersion = modelVersion;
    }

    public String modelVersion() {
        return modelVersion;
    }

    /** 추론을 부르고 응답이 요청과 맞는지 확인한다. */
    public Observation infer(InferenceRequest request) {
        Observation result;
        try {
            result = client.post().uri("/v2/infer").body(request).retrieve().body(Observation.class);
        } catch (RestClientException unavailable) {
            throw ApiError.upstream("inference unavailable or rejected input; retry same request");
        }
        if (result == null) throw ApiError.upstream("empty inference response");
        require(request, result);
        return result;
    }

    /**
     * 프레임 묶음 추론(v3). 연결·응답 오류는 한 번만 다시 부른다(계획 0064). 계약과 맞지 않는 응답은 다시 부르지 않는다.
     */
    public FrameInference.Response infer(FrameInference.Request request) {
        FrameInference.Response result = null;
        for (int attempt = 0; result == null; attempt++) {
            try {
                result = client.post().uri("/v3/infer").body(request).retrieve().body(FrameInference.Response.class);
                if (result == null) throw ApiError.upstream("empty inference response");
            } catch (RestClientException unavailable) {
                if (attempt >= 1) throw ApiError.upstream("inference unavailable or rejected input");
            }
        }
        require(request, result);
        return result;
    }

    /**
     * 결과가 이 요청의 프레임마다 하나씩, 같은 순서·같은 {@code t_ms}이고, 판정에 쓸 수 없는 프레임(사람 없음·앱의
     * 판정 불가 표시)을 유효로 표시하지 않았는지 확인한다.
     */
    void require(FrameInference.Request request, FrameInference.Response response) {
        if (!"3.0".equals(response.schemaVersion())
                || !modelVersion.equals(response.modelVersion())
                || response.frames() == null
                || response.frames().size() != request.frames().size())
            throw ApiError.upstream("inference response contract mismatch");
        for (int index = 0; index < response.frames().size(); index++) {
            var result = response.frames().get(index);
            var frame = request.frames().get(index);
            boolean usable =
                    result != null
                            && result.tMs() == frame.tMs()
                            && Double.isFinite(result.collapseProbability())
                            && result.collapseProbability() >= 0
                            && result.collapseProbability() <= 1
                            && result.deviationType() != null
                            && (result.valid()
                                    ? frame.tracked() && result.invalidReason() == null
                                    : result.collapseProbability() == 0
                                            && result.deviationType() == Observation.DeviationType.none
                                            && ("unmeasurable".equals(result.invalidReason())
                                                    || "head_turn".equals(result.invalidReason())));
            if (!usable) throw ApiError.upstream("inference response contract mismatch");
        }
    }

    /** 결과가 이 요청에 대한 것이고, 품질이 낮은 구간을 유효로 표시하지 않았는지 확인한다(ADR 0020). */
    void require(InferenceRequest request, Observation observation) {
        boolean measurable =
                request.phase() == Observation.Phase.running
                        && request.measurementQuality() == InferenceRequest.MeasurementQuality.good
                        && request.features() != null
                        && request.features().currentQuality() >= 0.65
                        && request.features().baselineQuality() >= 0.65;
        if (!"2.0".equals(observation.schemaVersion())
                || observation.sequence() != request.sequence()
                || observation.startMs() != request.startMs()
                || observation.endMs() != request.endMs()
                || observation.phase() != request.phase()
                || observation.collapseProbability() < 0
                || observation.collapseProbability() > 1
                || observation.deviationType() == null
                || !modelVersion.equals(observation.modelVersion())
                || (observation.valid() && !measurable)
                || (!observation.valid()
                        && (observation.collapseProbability() != 0
                                || observation.deviationType() != Observation.DeviationType.none)))
            throw ApiError.upstream("inference response contract mismatch");
    }

    /** 개발에서는 loopback 주소, Compose에서는 토큰과 함께 내부 호스트만 허용한다. */
    static void requireEndpoint(String url, boolean internal, String token) {
        var uri = URI.create(url);
        boolean host =
                "127.0.0.1".equals(uri.getHost()) || (internal && "inference".equals(uri.getHost()));
        if (!"http".equals(uri.getScheme())
                || !host
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || !(uri.getPath() == null || uri.getPath().isEmpty()))
            throw new IllegalArgumentException(
                    "inference must be a loopback or internal HTTP endpoint");
        if (internal && !token.matches("[A-Za-z0-9_-]{32,512}"))
            throw new IllegalArgumentException("internal token configuration required");
    }

    /** 내부 토큰이 다른 주소로의 리다이렉트를 따라가지 않게 한다. */
    private static final class NoRedirectRequestFactory extends SimpleClientHttpRequestFactory {
        @Override
        protected void prepareConnection(HttpURLConnection connection, String method)
                throws IOException {
            super.prepareConnection(connection, method);
            connection.setInstanceFollowRedirects(false);
        }
    }
}
