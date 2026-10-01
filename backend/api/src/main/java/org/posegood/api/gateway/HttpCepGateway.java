package org.posegood.api.gateway;

import org.posegood.contracts.ContractError;
import org.posegood.contracts.CreateSession;
import org.posegood.contracts.EndSession;
import org.posegood.contracts.Observation;
import org.posegood.contracts.SessionView;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;
import java.util.UUID;

@Component
public class HttpCepGateway implements CepGateway {
    private final RestClient client;

    public HttpCepGateway(RestClient.Builder builder, @Value("${posegood.cep-url}") String url) {
        var uri = URI.create(url);
        if (!"http".equals(uri.getScheme())
                || !"127.0.0.1".equals(uri.getHost())
                || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("development CEP endpoint must be loopback HTTP");
        }

        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(3000);
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
