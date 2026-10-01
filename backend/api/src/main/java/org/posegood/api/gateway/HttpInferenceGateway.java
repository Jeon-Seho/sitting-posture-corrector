package org.posegood.api.gateway;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class HttpInferenceGateway implements InferenceGateway {
    private final RestClient client;

    public HttpInferenceGateway(
            RestClient.Builder builder, @Value("${posegood.inference-url}") String url) {
        this(builder, url, false, "");
    }

    @Autowired
    public HttpInferenceGateway(
            RestClient.Builder builder,
            @Value("${posegood.inference-url}") String url,
            @Value("${posegood.internal-hosts-enabled:false}") boolean internal,
            @Value("${posegood.internal-token:}") String token) {
        GatewayEndpoint.require(url, "inference", internal, token);

        var factory = new NoRedirectRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(3000);
        if (internal) builder.defaultHeader("X-PoseGood-Internal-Token", token);
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
