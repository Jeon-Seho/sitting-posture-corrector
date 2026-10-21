package com.posture.api.posture.cep.v1;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * (D-22) 판정 결과를 {@code posture.episodes.v1}에 발행한다(키 = session_id).
 *
 * <p>판정 스레드를 막지 않도록 전송 완료를 기다리지 않는다. 같은 키는 같은 파티션으로 가고 프로듀서가 순서를 지키므로
 * "사건을 그 사건이 반영된 progress보다 먼저"가 유지된다(acks=all, 재시도 시에도 멱등 프로듀서 기본값).
 * 실패는 로그로 남긴다.
 */
@Component
public class KafkaEpisodesSink implements EpisodesSink {

    private static final Logger log = LoggerFactory.getLogger(KafkaEpisodesSink.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final JsonMapper jsonMapper;
    private final String topic;

    public KafkaEpisodesSink(
            KafkaTemplate<String, String> kafkaTemplate,
            JsonMapper jsonMapper,
            @Value("${app.kafka.topic.posture-episodes-v1:posture.episodes.v1}") String topic) {
        this.kafkaTemplate = kafkaTemplate;
        this.jsonMapper = jsonMapper;
        this.topic = topic;
    }

    @Override
    public void publish(String sessionId, String userId, String kind, Map<String, Object> body) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schema_version", "1.0");
        envelope.put("message_id", UUID.randomUUID().toString());
        envelope.put("session_id", sessionId);
        envelope.put("user_id", userId);
        envelope.put("produced_at", Instant.now().toString());
        envelope.put("kind", kind);
        envelope.put("body", body);
        String json = jsonMapper.writeValueAsString(envelope);
        kafkaTemplate.send(topic, sessionId, json).whenComplete((result, error) -> {
            if (error != null) {
                log.error("posture.episodes.v1 발행 실패 (sessionId={}, kind={}): {}", sessionId, kind, error.getMessage());
            }
        });
    }
}
