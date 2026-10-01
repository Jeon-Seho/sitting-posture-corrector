package org.posegood.api.gateway;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;

@Component
public class HttpInferenceGateway implements InferenceGateway {
    private final RestClient client;

    public HttpInferenceGateway(
            RestClient.Builder builder, @Value("${posegood.inference-url}") String url) {
        var uri = URI.create(url);
        if (!"http".equals(uri.getScheme())
                || !"127.0.0.1".equals(uri.getHost())
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || !(uri.getPath() == null || uri.getPath().isEmpty())) {
            throw new IllegalArgumentException(
                    "development inference endpoint must be loopback HTTP");
        }

        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(3000);
        client = builder.baseUrl(url).requestFactory(factory).build();
    }

    @Override
    public Observation infer(InferenceRequest request) {
        try {
            var result =
                    client.post().uri("/v2/infer").body(request).retrieve().body(Observation.class);
            if (result == null) {
                throw new ContractError(502, "empty inference response");
            }
            return result;
        } catch (HttpStatusCodeException error) {
            throw new ContractError(502, "inference unavailable or rejected input");
        } catch (RestClientException error) {
            throw new ContractError(502, "inference unavailable; retry same request");
        }
    }
}
