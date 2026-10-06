package org.posegood.api.gateway;

import java.net.URI;

final class GatewayEndpoint {
    private GatewayEndpoint() {}

    static void require(String url, String internalHost, boolean internalEnabled, String token) {
        var uri = URI.create(url);
        boolean validHost =
                "127.0.0.1".equals(uri.getHost())
                        || (internalEnabled && internalHost.equals(uri.getHost()));
        if (!"http".equals(uri.getScheme())
                || !validHost
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || !(uri.getPath() == null || uri.getPath().isEmpty()))
            throw new IllegalArgumentException(
                    "upstream must be configured loopback or internal HTTP endpoint");
        if (internalEnabled && !token.matches("[A-Za-z0-9_-]{32,512}"))
            throw new IllegalArgumentException("internal token configuration required");
    }
}
