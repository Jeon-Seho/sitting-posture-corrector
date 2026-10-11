package org.posegood.api.session;

import org.posegood.api.common.ApiError;
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
 * FastAPI {@code POST /v2/infer}. The output is checked against the request before it reaches the
 * decision engine; a mismatch is a 502 and the session state does not change.
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

    /** The output must answer this request and keep low quality out of valid time (ADR 0013). */
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

    /** Loopback in development, a named internal host with a token in Compose. */
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

    /** The internal token must never follow a redirect to another authority. */
    private static final class NoRedirectRequestFactory extends SimpleClientHttpRequestFactory {
        @Override
        protected void prepareConnection(HttpURLConnection connection, String method)
                throws IOException {
            super.prepareConnection(connection, method);
            connection.setInstanceFollowRedirects(false);
        }
    }
}
