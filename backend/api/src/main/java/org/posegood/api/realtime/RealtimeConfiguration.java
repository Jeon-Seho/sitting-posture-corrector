package org.posegood.api.realtime;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import java.util.Arrays;

/**
 * {@code /v1/realtime}. Without configured origins only same-origin pages may connect (the proxy
 * must forward the original Host with its port). One features frame holds up to 30 intervals.
 */
@Configuration
@EnableWebSocket
public class RealtimeConfiguration implements WebSocketConfigurer {
    private final RealtimeHandler handler;
    private final String[] origins;

    public RealtimeConfiguration(
            RealtimeHandler handler, @Value("${posegood.realtime.allowed-origins:}") String origins) {
        this.handler = handler;
        this.origins =
                Arrays.stream(origins.split(",")).map(String::strip).filter(o -> !o.isEmpty()).toArray(String[]::new);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        var registration = registry.addHandler(handler, "/v1/realtime");
        if (origins.length > 0) registration.setAllowedOrigins(origins);
    }

    @Bean
    ServletServerContainerFactoryBean webSocketContainer() {
        var container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(64 * 1024);
        container.setMaxSessionIdleTimeout(120_000L);
        return container;
    }
}
