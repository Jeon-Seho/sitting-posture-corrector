package org.posegood.api.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.ContractError;
import org.posegood.contracts.InferenceRequest;
import org.posegood.contracts.Observation;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;
import java.util.UUID;

class HttpInferenceGatewayTest {
    private static final String URL = "http://127.0.0.1:8092";
    private static final InferenceRequest REQUEST =
            new InferenceRequest(
                    "2.0",
                    "shoulder-relative-deltas-v1",
                    UUID.fromString("11111111-1111-1111-1111-111111111111"),
                    0,
                    0,
                    1000,
                    Observation.Phase.rest,
                    InferenceRequest.MeasurementQuality.poor,
                    null);

    private static class Fixture {
        final RestClient.Builder builder = mock(RestClient.Builder.class);
        final RestClient client = mock(RestClient.class);
        final RestClient.RequestBodyUriSpec uri = mock(RestClient.RequestBodyUriSpec.class);
        final RestClient.RequestBodySpec body = mock(RestClient.RequestBodySpec.class);
        final RestClient.ResponseSpec response = mock(RestClient.ResponseSpec.class);
        final HttpInferenceGateway gateway;

        Fixture() {
            when(builder.baseUrl(URL)).thenReturn(builder);
            when(builder.requestFactory(any(ClientHttpRequestFactory.class))).thenReturn(builder);
            when(builder.build()).thenReturn(client);
            when(client.post()).thenReturn(uri);
            when(uri.uri("/v2/infer")).thenReturn(body);
            when(body.body(REQUEST)).thenReturn(body);
            when(body.retrieve()).thenReturn(response);
            gateway = new HttpInferenceGateway(builder, URL);
        }
    }

    @Test
    void sendsTheOriginalVersionedRequestToFixedInferenceRoute() {
        var fixture = new Fixture();
        var output =
                new Observation(
                        "2.0",
                        0,
                        0,
                        1000,
                        Observation.Phase.rest,
                        false,
                        0,
                        Observation.DeviationType.none,
                        "reference-feature-rule-v1");
        when(fixture.response.body(Observation.class)).thenReturn(output);
        assertEquals(output, fixture.gateway.infer(REQUEST));
        verify(fixture.uri).uri("/v2/infer");
        verify(fixture.body).body(REQUEST);
    }

    @Test
    void emptyRejectedAndUnavailableInferenceProduceSafeGatewayErrors() {
        var empty = new Fixture();
        assertEquals(
                502,
                assertThrows(ContractError.class, () -> empty.gateway.infer(REQUEST)).status());
        for (var failure :
                List.of(
                        new RestClientException("synthetic unavailable"),
                        new HttpClientErrorException(HttpStatus.UNPROCESSABLE_ENTITY),
                        new HttpClientErrorException(HttpStatus.TOO_MANY_REQUESTS))) {
            var fixture = new Fixture();
            when(fixture.response.body(Observation.class)).thenThrow(failure);
            assertEquals(
                    502,
                    assertThrows(ContractError.class, () -> fixture.gateway.infer(REQUEST))
                            .status());
        }
    }

    @Test
    void rejectsNonLoopbackOrAmbiguousInferenceEndpoints() {
        for (var invalid :
                List.of(
                        "https://127.0.0.1:8092",
                        "http://localhost:8092",
                        "http://192.0.2.1:8092",
                        "http://user@127.0.0.1:8092",
                        "http://127.0.0.1:8092?token=synthetic",
                        "http://127.0.0.1:8092#fragment",
                        "http://127.0.0.1:8092/alternate")) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> new HttpInferenceGateway(RestClient.builder(), invalid));
        }
    }
}
