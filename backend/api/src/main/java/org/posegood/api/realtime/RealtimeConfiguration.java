package org.posegood.api.realtime;

import java.util.Arrays;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * /v2/realtime WebSocket 등록과 허용 출처·메시지 크기 설정.
 *
 * 허용 출처를 설정하지 않으면 같은 출처 페이지만 연결할 수 있다(프록시는 원래 Host와 포트를 넘겨야 한다).
 * 메시지는 64KB까지 받고, 넘으면 연결을 끊는 대신 {@code closed(bad_message)}를 보낼 수 있게 컨테이너 버퍼를
 * 그보다 크게(128KB) 둔다. v1(/v1/realtime)은 앱이 v2로 넘어가 삭제했다.
 */
@Configuration
@EnableWebSocket
public class RealtimeConfiguration implements WebSocketConfigurer {
	private final RealtimeHandlerV2 handlerV2;
	private final String[] origins;

	public RealtimeConfiguration(
		RealtimeHandlerV2 handlerV2,
		@Value("${posegood.realtime.allowed-origins:}")
		String origins) {
		this.handlerV2 = handlerV2;
		this.origins = Arrays.stream(origins.split(",")).map(String::strip).filter(o -> !o.isEmpty())
			.toArray(String[]::new);
	}

	@Override
	public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
		var v2 = registry.addHandler(handlerV2, "/v2/realtime");
		if (origins.length > 0) {
			v2.setAllowedOrigins(origins);
		}
	}

	@Bean
	ServletServerContainerFactoryBean webSocketContainer() {
		var container = new ServletServerContainerFactoryBean();
		container.setMaxTextMessageBufferSize(2 * RealtimeHandlerV2.MAX_BYTES);
		container.setMaxSessionIdleTimeout(120_000L);
		return container;
	}
}
