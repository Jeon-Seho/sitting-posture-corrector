package org.posegood.api.gateway;

import org.springframework.http.client.SimpleClientHttpRequestFactory;

import java.io.IOException;
import java.net.HttpURLConnection;

/** A protected internal token must never follow an upstream redirect to another authority. */
final class NoRedirectRequestFactory extends SimpleClientHttpRequestFactory {
    @Override
    protected void prepareConnection(HttpURLConnection connection, String method)
            throws IOException {
        super.prepareConnection(connection, method);
        connection.setInstanceFollowRedirects(false);
    }
}
