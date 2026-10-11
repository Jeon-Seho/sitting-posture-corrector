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
 * /v1/realtime WebSocket 등록과 허용 출처·메시지 크기 설정.
 *
 * 허용 출처를 설정하지 않으면 같은 출처 페이지만 연결할 수 있다(프록시는 원래 Host와 포트를 넘겨야 한다).
 * features 메시지 하나에는 최대 30구간이 들어간다.
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
