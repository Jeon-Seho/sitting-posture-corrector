package org.posegood.api.session;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;

import org.posegood.api.common.ApiError;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * FastAPI 추론 호출(POST /v2/infer)과 결과 검증. 실패하거나 맞지 않으면 502.
 *
 * 결과는 판정 엔진에 넣기 전에 요청과 대조한다. 맞지 않으면 502이고 세션 상태는 바뀌지 않는다.
 */
@Component
public class InferenceClient {
	private final RestClient client;
	private final String modelVersion;

	public InferenceClient(
		RestClient.Builder builder,
		@Value("${posegood.inference-url}")
		String url,
		@Value("${posegood.internal-hosts-enabled:false}")
		boolean internal,
		@Value("${posegood.internal-token:}")
		String token,
		@Value("${posegood.model-version}")
		String modelVersion) {
		requireEndpoint(url, internal, token);
		var factory = new NoRedirectRequestFactory();
		factory.setConnectTimeout(2000);
		factory.setReadTimeout(3000);
		if (internal) {
			builder.defaultHeader("X-PoseGood-Internal-Token", token);
		}
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
		if (result == null) {
			throw ApiError.upstream("empty inference response");
		}
		require(request, result);
		return result;
	}

	/** 결과가 이 요청에 대한 것이고, 품질이 낮은 구간을 유효로 표시하지 않았는지 확인한다(ADR 0020). */
	void require(InferenceRequest request, Observation observation) {
		boolean measurable = request.phase() == Observation.Phase.running
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
					|| observation.deviationType() != Observation.DeviationType.none))) {
			throw ApiError.upstream("inference response contract mismatch");
		}
	}

	/** 개발에서는 loopback 주소, Compose에서는 토큰과 함께 내부 호스트만 허용한다. */
	static void requireEndpoint(String url, boolean internal, String token) {
		var uri = URI.create(url);
		boolean host = "127.0.0.1".equals(uri.getHost()) || (internal && "inference".equals(uri.getHost()));
		if (!"http".equals(uri.getScheme())
			|| !host
			|| uri.getUserInfo() != null
			|| uri.getQuery() != null
			|| uri.getFragment() != null
			|| !(uri.getPath() == null || uri.getPath().isEmpty())) {
			throw new IllegalArgumentException(
				"inference must be a loopback or internal HTTP endpoint");
		}
		if (internal && !token.matches("[A-Za-z0-9_-]{32,512}")) {
			throw new IllegalArgumentException("internal token configuration required");
		}
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
