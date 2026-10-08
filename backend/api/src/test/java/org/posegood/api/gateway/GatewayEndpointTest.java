package org.posegood.api.gateway;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class GatewayEndpointTest {
    @Test
    void containerAuthorityAndTokenAreAllowedOnlyWhenExplicitlyEnabled() {
        String token = "synthetic_internal_token_1234567890";
        assertDoesNotThrow(
                () -> new HttpCepGateway(RestClient.builder(), "http://cep:8091", true, token));
        assertDoesNotThrow(
                () ->
                        new HttpInferenceGateway(
                                RestClient.builder(), "http://inference:8092", true, token));
        assertThrows(
                IllegalArgumentException.class,
                () -> new HttpCepGateway(RestClient.builder(), "http://cep:8091"));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new HttpInferenceGateway(
                                RestClient.builder(),
                                "http://external.example.invalid:8092",
                                true,
                                token));
        assertThrows(
                IllegalArgumentException.class,
                () -> new HttpCepGateway(RestClient.builder(), "http://cep:8091", true, ""));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new HttpInferenceGateway(
                                RestClient.builder(),
                                "http://user:password@inference:8092",
                                true,
                                token));
    }

    @Test
    void protectedGetRequestsNeverFollowRedirects() throws Exception {
        var connection = org.mockito.Mockito.mock(java.net.HttpURLConnection.class);
        new NoRedirectRequestFactory().prepareConnection(connection, "GET");
        org.mockito.Mockito.verify(connection).setInstanceFollowRedirects(false);
    }
}
