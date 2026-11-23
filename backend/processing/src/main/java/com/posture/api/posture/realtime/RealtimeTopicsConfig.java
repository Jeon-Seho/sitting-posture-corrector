package com.posture.api.posture.realtime;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/**
 * (D-21) 실시간 Kafka 계약 토픽 3개 + (D-54) 알림 토픽 + (D-67) 저장 완료 + (D-92) 좌표 적재 + (D-36) DLQ. 없으면 시작 시 만든다(이미 있으면 그대로 둔다).
 * 파티션 수는 판정 컨슈머 스레드 수(기본 3)와 맞춘다. 키는 {@code session_id}.
 *
 * <p>(D-82) 보존 주기 — 사용자별로 지울 수 없는 Kafka는 탈퇴 삭제(30일)보다 짧게 둔다.
 * 실시간 토픽 6개는 3일, DLQ는 7일(원문 확인용). 세그먼트는 모두 1일 — Kafka는 닫힌 세그먼트 파일 단위로만
 * 지우므로, 브로커 기본값(7일)이면 보존 3일이어도 최대 약 10일 남는다.
 * 이 설정은 토픽을 새로 만들 때만 들어간다. 이미 있는 토픽은 {@code kafka-configs.sh --alter}로 맞춘다
 * (infra/README 「Kafka 토픽 보존 설정」).
 */
@Configuration
public class RealtimeTopicsConfig {

	static final String REALTIME_RETENTION_MS = String.valueOf(3L * 24 * 60 * 60 * 1000);
	static final String DLQ_RETENTION_MS = String.valueOf(7L * 24 * 60 * 60 * 1000);
	static final String SEGMENT_MS = String.valueOf(24L * 60 * 60 * 1000);

	private static NewTopic realtime(String name, int partitions) {
		return TopicBuilder.name(name).partitions(partitions).replicas(1)
			.config("retention.ms", REALTIME_RETENTION_MS)
			.config("segment.ms", SEGMENT_MS).build();
	}

	@Bean
	public NewTopic postureFeaturesTopic(
		@Value("${app.kafka.topic.posture-features:posture.features}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	@Bean
	public NewTopic postureInferenceTopic(
		@Value("${app.kafka.topic.posture-inference:posture.inference}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	@Bean
	public NewTopic postureEpisodesTopic(
		@Value("${app.kafka.topic.posture-episodes:posture.episodes}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	/** (D-54) 표시할 알림 — 판정 결과 저장 → 입출구 서버 {@code ws}. 키 session_id. */
	@Bean
	public NewTopic postureAlertsTopic(
		@Value("${app.kafka.topic.posture-alerts:posture.alerts}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	/** (D-67) 저장 완료 — 판정 결과 저장 → 입출구 서버 {@code ws}(정상 종료를 저장 뒤에 알림). 키 session_id. */
	@Bean
	public NewTopic postureStoredTopic(
		@Value("${app.kafka.topic.posture-stored:posture.stored}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	/**
	 * (D-92) 좌표 구간 적재 — 입출구 서버 {@code ws} → Spark J1(HDFS 세션 폴더 {@code keypoints.jsonl}).
	 * 처리 서비스는 읽지 않는다. 키 session_id. 사용자 폴더는 J3가 지운다.
	 */
	@Bean
	public NewTopic postureKeypointsTopic(
		@Value("${app.kafka.topic.posture-keypoints:posture.keypoints}")
		String name,
		@Value("${app.kafka.realtime-partitions:3}")
		int partitions) {
		return realtime(name, partitions);
	}

	/** (D-36) 처리 못 한 메시지 보관. 순서가 중요하지 않아 파티션 1개. 보존 7일. */
	@Bean
	public NewTopic postureDlqTopic(
		@Value("${app.kafka.topic.posture-dlq:posture.dlq}")
		String name) {
		return TopicBuilder.name(name).partitions(1).replicas(1)
			.config("retention.ms", DLQ_RETENTION_MS)
			.config("segment.ms", SEGMENT_MS).build();
	}
}
