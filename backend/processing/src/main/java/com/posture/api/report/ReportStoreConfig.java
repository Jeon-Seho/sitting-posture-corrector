package com.posture.api.report;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * (D-30) 판정 결과 저장 컨슈머 전용 컨테이너. DB 장애로 저장하지 못하면 같은 메시지를 {@code report.store.retry-backoff-ms}마다
 * 끝없이 다시 시도한다(그동안 이 그룹만 멈추고 판정은 계속). DB가 돌아오면 밀린 메시지를 순서대로 저장한다 — Kafka 보존 기간 안이면 유실 없음.
 * 다른 컨슈머는 기본 컨테이너 그대로다.
 */
@Configuration
public class ReportStoreConfig {

	public static final String FACTORY = "reportStoreContainerFactory";

	@Bean(name = FACTORY)
	public ConcurrentKafkaListenerContainerFactory<String, String> reportStoreContainerFactory(
		ConsumerFactory<String, String> consumerFactory,
		@Value("${report.store.retry-backoff-ms:5000}")
		long backoffMs) {
		ConcurrentKafkaListenerContainerFactory<String, String> factory =
			new ConcurrentKafkaListenerContainerFactory<>();
		factory.setConsumerFactory(consumerFactory);
		factory.setCommonErrorHandler(
			new DefaultErrorHandler(new FixedBackOff(backoffMs, FixedBackOff.UNLIMITED_ATTEMPTS)));
		return factory;
	}
}
