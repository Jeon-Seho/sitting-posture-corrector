package org.posegood.api.gateway;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.RestoreSession;
import org.posegood.contracts.SessionView;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.UUID;

@Component
public class HttpCepGateway implements CepGateway {
    private final RestClient client;

    public HttpCepGateway(RestClient.Builder builder, @Value("${posegood.cep-url}") String url) {
        this(builder, url, false, "");
    }

    @Autowired
    public HttpCepGateway(
            RestClient.Builder builder,
            @Value("${posegood.cep-url}") String url,
            @Value("${posegood.internal-hosts-enabled:false}") boolean internal,
            @Value("${posegood.internal-token:}") String token) {
        GatewayEndpoint.require(url, "cep", internal, token);

        var factory = new NoRedirectRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(3000);
        if (internal) builder.defaultHeader("X-PoseGood-Internal-Token", token);
        client = builder.baseUrl(url + "/internal/sessions").requestFactory(factory).build();
    }

    @Override
    public SessionView create(UUID id, CreateSession request) {
        return send(client.put().uri("/{id}", id), request);
    }

    @Override
    public SessionView observe(UUID id, Observation observation) {
        return send(client.post().uri("/{id}/observations", id), observation);
    }

    @Override
    public SessionView end(UUID id, EndSession request) {
        return send(client.post().uri("/{id}/end", id), request);
    }

    @Override
    public SessionView get(UUID id) {
        try {
            return client.get().uri("/{id}", id).retrieve().body(SessionView.class);
        } catch (HttpStatusCodeException error) {
            if (error.getStatusCode().value() == 404)
                throw new ContractError(404, "CEP session not found");
            throw new ContractError(502, "CEP unavailable");
        } catch (RestClientException error) {
            throw new ContractError(502, "CEP unavailable");
        }
    }

    @Override
    public SessionView restore(UUID id, RestoreSession request) {
        return send(client.post().uri("/{id}/restore", id), request);
    }

    @Override
    public void delete(UUID id) {
        try {
            client.delete().uri("/{id}", id).retrieve().toBodilessEntity();
        } catch (RestClientException error) {
            throw new ContractError(502, "CEP cleanup unavailable");
        }
    }

    private SessionView send(RestClient.RequestBodySpec request, Object body) {
        try {
            var result = request.body(body).retrieve().body(SessionView.class);
            if (result == null) {
                throw new ContractError(502, "empty CEP response");
            }
            return result;
        } catch (HttpStatusCodeException error) {
            if (error.getStatusCode().value() == 409) {
                throw new ContractError(409, "CEP rejected conflicting input");
            }
            if (error.getStatusCode().value() == 429) {
                throw new ContractError(429, "development CEP limit reached");
            }
            throw new ContractError(502, "CEP unavailable or rejected input");
        } catch (RestClientException error) {
            throw new ContractError(502, "CEP unavailable; retry same request");
        }
    }
}
