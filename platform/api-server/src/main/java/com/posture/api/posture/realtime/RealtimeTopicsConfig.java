package com.posture.api.posture.realtime;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/**
 * (D-21) 실시간 계약 v1 토픽 3개. 없으면 시작 시 만든다(이미 있으면 그대로 둔다).
 * 파티션 수는 판정 컨슈머 스레드 수(기본 3)와 맞춘다. 키는 {@code session_id}.
 */
@Configuration
public class RealtimeTopicsConfig {

    @Bean
    public NewTopic postureFeaturesV1Topic(
            @Value("${app.kafka.topic.posture-features-v1:posture.features.v1}") String name,
            @Value("${app.kafka.realtime-partitions:3}") int partitions) {
        return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
    }

    @Bean
    public NewTopic postureInferenceV1Topic(
            @Value("${app.kafka.topic.posture-inference-v1:posture.inference.v1}") String name,
            @Value("${app.kafka.realtime-partitions:3}") int partitions) {
        return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
    }

    @Bean
    public NewTopic postureEpisodesV1Topic(
            @Value("${app.kafka.topic.posture-episodes-v1:posture.episodes.v1}") String name,
            @Value("${app.kafka.realtime-partitions:3}") int partitions) {
        return TopicBuilder.name(name).partitions(partitions).replicas(1).build();
    }
}
