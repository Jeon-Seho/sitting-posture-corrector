package com.posture.api.report;

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
import java.util.concurrent.atomic.AtomicLong;

/**
 * (D-54) 알림을 {@code posture.alerts.v1}(키 = session_id)로 발행한다. 계약: {@code contracts/realtime/kafka-alerts.v1.schema.json}.
 * 입출구 서버 {@code ws}가 구독해 앱에 WebSocket {@code alert}로 그대로 보낸다(걸러내지 않음).
 *
 * <p>저장 스레드를 막지 않도록 전송 완료를 기다리지 않는다. 실패는 로그·횟수로만 남긴다 — 알림은 그 순간에만 의미가 있어
 * 다시 보내지 않는다(DB의 알림 행은 이미 기록됨).
 */
@Component
public class KafkaAlertPublisher implements AlertPublisher {

    private static final Logger log = LoggerFactory.getLogger(KafkaAlertPublisher.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final JsonMapper jsonMapper;
    private final String topic;
    private final AtomicLong failures = new AtomicLong();

    public KafkaAlertPublisher(
            KafkaTemplate<String, String> kafkaTemplate,
            JsonMapper jsonMapper,
            @Value("${app.kafka.topic.posture-alerts-v1:posture.alerts.v1}") String topic) {
        this.kafkaTemplate = kafkaTemplate;
        this.jsonMapper = jsonMapper;
        this.topic = topic;
    }

    /** 봉투째 만든다(계약 alerts.v1). */
    static Map<String, Object> message(EpisodeDecision d, Instant now) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("event_id", d.eventId());
        body.put("kind", d.kind());
        body.put("deviation_type", d.deviationType());
        body.put("timestamp_ms", d.timestampMs());
        body.put("onset_ms", d.onsetMs());
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schema_version", "1.0");
        envelope.put("message_id", UUID.randomUUID().toString());
        envelope.put("session_id", d.sessionId());
        envelope.put("user_id", d.userId());
        envelope.put("produced_at", now.toString());
        envelope.put("kind", "alert");
        envelope.put("body", body);
        return envelope;
    }

    @Override
    public void publish(EpisodeDecision d) {
        String json = jsonMapper.writeValueAsString(message(d, Instant.now()));
        kafkaTemplate.send(topic, d.sessionId(), json).whenComplete((result, error) -> {
            if (error != null) {
                failures.incrementAndGet();
                log.error("posture.alerts.v1 발행 실패 (sessionId={}, event_id={}): {}", d.sessionId(), d.eventId(),
                        error.getMessage());
            }
        });
    }

    public long failures() {
        return failures.get();
    }
}
