package org.posegood.api.realtime;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;

import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.posegood.api.common.Json;
import org.posegood.api.session.SessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 측정 뒤쪽 고르기: {@code posegood.realtime.pipeline}(환경 변수 {@code POSEGOOD_REALTIME_PIPELINE}, 기본 {@code local}).
 *
 * <p>{@code local}이면 Kafka에 연결하지 않는다(팀 compose처럼 Kafka가 없어도 뜬다). {@code kafka}면 발행용 프로듀서와
 * 결과 구독({@link KafkaResults})을 만들어 {@link KafkaPipeline}을 쓴다. 그 밖의 값이면 시작하지 않는다(설정 실수로 조용히
 * local이 되지 않게). Spring Boot의 Kafka 자동 설정은 쓰지 않는다 — local에서 연결을 시도하지 않게 kafka-clients만 쓴다.
 */
@Configuration(proxyBeanMethods = false)
class RealtimePipelineConfiguration {
	@Bean
	MeasurementPipeline measurementPipeline(
		@Value("${posegood.realtime.pipeline:local}")
		String pipeline,
		@Value("${posegood.realtime.kafka.bootstrap-servers:localhost:9092}")
		String bootstrapServers,
		@Value("${posegood.realtime.kafka.features-topic:posture.features.v1}")
		String featuresTopic,
		@Value("${posegood.realtime.kafka.episodes-topic:posture.episodes.v1}")
		String episodesTopic,
		@Value("${posegood.realtime.kafka.alerts-topic:posture.alerts.v1}")
		String alertsTopic,
		@Value("${posegood.realtime.kafka.stored-topic:posture.stored.v1}")
		String storedTopic,
		@Value("${posegood.realtime.kafka.group-id:io-ws-local}")
		String groupId,
		@Value("${posegood.realtime.kafka.send-timeout:3s}")
		Duration sendTimeout,
		@Value("${posegood.realtime.max-session-duration}")
		Duration maxSession,
		@Value("${posegood.realtime.unmeasurable-timeout}")
		Duration unmeasurableTimeout,
		SessionService sessions,
		Json json,
		ApplicationEventPublisher events) {
		return switch (pipeline) {
			case "local" -> new LocalPipeline(sessions);
			case "kafka" -> {
				var kafka = new KafkaPipeline(
					sessions, producer(bootstrapServers, sendTimeout), featuresTopic, json, sendTimeout, maxSession,
					Clock.systemUTC());
				var results = new KafkaResults(consumer(bootstrapServers, groupId), episodesTopic, alertsTopic,
					storedTopic, json,
					events, kafka::hint, unmeasurableTimeout);
				kafka.attach(results);
				results.start();
				yield kafka;
			}
			default -> throw new IllegalStateException(
				"posegood.realtime.pipeline must be local or kafka (got " + pipeline + ")");
		};
	}

	/** 브로커 저장 확인(acks=all)·중복 없는 재시도(멱등). 구간마다 바로 보내되 5ms까지 모아 보낸다. */
	private static KafkaProducer<String, String> producer(String bootstrapServers, Duration sendTimeout) {
		int timeout = (int)sendTimeout.toMillis();
		Map<String, Object> config = Map.of(
			ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers,
			ProducerConfig.ACKS_CONFIG, "all",
			ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true,
			ProducerConfig.LINGER_MS_CONFIG, 5,
			ProducerConfig.CLIENT_ID_CONFIG, "io-api-ws",
			ProducerConfig.MAX_BLOCK_MS_CONFIG, timeout,
			ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, timeout,
			ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, timeout + 5,
			ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
			ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
		return new KafkaProducer<>(config);
	}

	/**
	 * 결과 구독: 입출구 서버마다 그룹(모든 결과를 받아 자기 연결 것만 보냄), 처음엔 최신 위치부터. 결과는 연결이 있는 동안만
	 * 쓸모가 있어(재연결 없음, ADR 0024) 자동 커밋으로 충분하다.
	 */
	private static KafkaConsumer<String, String> consumer(String bootstrapServers, String groupId) {
		Map<String, Object> config = Map.of(
			ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers,
			ConsumerConfig.GROUP_ID_CONFIG, groupId,
			ConsumerConfig.CLIENT_ID_CONFIG, "io-api-ws-results",
			ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest",
			ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, true,
			ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500,
			ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
			ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
		return new KafkaConsumer<>(config);
	}
}
