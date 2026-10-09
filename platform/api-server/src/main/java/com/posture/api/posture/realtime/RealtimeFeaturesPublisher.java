package com.posture.api.posture.realtime;

import com.posture.api.posture.service.KafkaPublishException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * (D-21) 검사를 통과한 {@code posture.features.v1} 메시지를 그대로(바꾸지 않고) 발행한다.
 * 메시지 키는 계약대로 {@code session_id} — 같은 세션의 시작·특징·종료가 같은 파티션에 순서대로 들어간다.
 */
@Service
public class RealtimeFeaturesPublisher {

    private static final Logger log = LoggerFactory.getLogger(RealtimeFeaturesPublisher.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String topic;

    public RealtimeFeaturesPublisher(
            KafkaTemplate<String, String> kafkaTemplate,
            @Value("${app.kafka.topic.posture-features-v1:posture.features.v1}") String topic) {
        this.kafkaTemplate = kafkaTemplate;
        this.topic = topic;
    }

    public void publish(String sessionId, String rawJson) {
        try {
            kafkaTemplate.send(topic, sessionId, rawJson).get(5, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            throw new KafkaPublishException(
                    "Kafka publish 실패 (topic=%s, sessionId=%s): %s".formatted(topic, sessionId, cause.getMessage()),
                    cause);
        } catch (TimeoutException e) {
            throw new KafkaPublishException(
                    "Kafka publish 타임아웃(5초 초과) (topic=%s, sessionId=%s)".formatted(topic, sessionId), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new KafkaPublishException(
                    "Kafka publish 중 인터럽트 (topic=%s, sessionId=%s)".formatted(topic, sessionId), e);
        }
        log.debug("posture.features.v1 발행 (sessionId={})", sessionId);
    }
}
