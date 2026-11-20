package com.posture.api.posture.realtime;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/**
 * (D-21) 실시간 Kafka 계약 토픽 3개 + (D-54) 알림 토픽 + (D-67) 저장 완료 + (D-92) 좌표 적재 + (D-36) DLQ. 없으면 시작 시 만든다(이미 있으면 그대로 둔다).
 * 파티션 수는 판정 컨슈머 스레드 수(기본 3)와 맞춘다. 키는 {@code session_id}.
 */
@Configuration
public class RealtimeTopicsConfig {

	@Bean
	public NewTopic postureFeaturesTopic(
		@Value("${app.kafka.topic.posture-features:posture.features}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
	}

	@Bean
	public NewTopic postureInferenceTopic(
		@Value("${app.kafka.topic.posture-inference:posture.inference}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
	}

	@Bean
	public NewTopic postureEpisodesTopic(
		@Value("${app.kafka.topic.posture-episodes:posture.episodes}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
	}

	/**
	 * (D-54) 표시할 알림 — 판정 결과 저장 → 입출구 서버 {@code ws}. 키 session_id, 보존 3일(v5.2, 탈퇴 30일 삭제보다 짧게, D-49).
	 * 보존 설정은 토픽을 새로 만들 때만 들어간다.
	 */
	@Bean
	public NewTopic postureAlertsTopic(
		@Value("${app.kafka.topic.posture-alerts:posture.alerts}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1)
			.config("retention.ms", String.valueOf(3L * 24 * 60 * 60 * 1000)).build();
	}

	/**
	 * (D-67) 저장 완료 — 판정 결과 저장 → 입출구 서버 {@code ws}(정상 종료를 저장 뒤에 알림). 키 session_id, 보존 3일(알림과 같음).
	 */
	@Bean
	public NewTopic postureStoredTopic(
		@Value("${app.kafka.topic.posture-stored:posture.stored}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1)
			.config("retention.ms", String.valueOf(3L * 24 * 60 * 60 * 1000)).build();
	}

	/**
	 * (D-92) 좌표 구간 적재 — 입출구 서버 {@code ws} → Spark J1(HDFS 세션 폴더 {@code keypoints.jsonl}). 처리 서비스는 읽지 않는다.
	 * 키 session_id, 보존 3일(탈퇴 30일 삭제보다 짧게 — 사용자 폴더는 J3가 지운다).
	 */
	@Bean
	public NewTopic postureKeypointsTopic(
		@Value("${app.kafka.topic.posture-keypoints:posture.keypoints}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1)
			.config("retention.ms", String.valueOf(3L * 24 * 60 * 60 * 1000)).build();
	}

	/** (D-36) 처리 못 한 메시지 보관. 순서가 중요하지 않아 파티션 1개. */
	@Bean
	public NewTopic postureDlqTopic(
		@Value("${app.kafka.topic.posture-dlq:posture.dlq}")
		String name) {
		return TopicBuilder.name(name).partitions(1).replicas(1).build();
	}
}
