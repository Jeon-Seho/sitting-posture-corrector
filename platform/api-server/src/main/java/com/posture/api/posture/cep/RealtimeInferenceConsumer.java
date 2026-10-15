package com.posture.api.posture.cep;

import com.posture.api.posture.cep.v1.V1JudgeRegistry;
import com.posture.api.posture.realtime.DeadLetterPublisher;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

/**
 * 실시간 계약 v1 {@code posture.inference.v1}을 구독한다.
 *
 * <p>(D-21) 처음에는 기존 판정 엔진에 넘겼다. (D-22) 이제 세션별 v1 판정기({@link V1JudgeRegistry})로 판정하고
 * 결과를 {@code posture.episodes.v1}로 발행한다. 기존 {@code posture.inference} 경로({@link PostureInferenceConsumer})는 그대로다.
 *
 * <p>컨슈머 그룹은 기존과 따로 둔다({@code api-server-cep-v1}). (D-36) 처리할 수 없는 메시지(JSON 오류·봉투 오류·모르는 kind·
 * 관측 형식 오류·처리 중 예외)는 {@code posture.dlq}로 넘기고 다음 메시지로 간다. 이미 반영한 sequence의 재전송은
 * 정상 동작이므로 DLQ로 보내지 않는다(판정기가 건너뛰고 수만 센다).
 */
@Component
public class RealtimeInferenceConsumer {

    private static final Logger log = LoggerFactory.getLogger(RealtimeInferenceConsumer.class);
    static final String CONSUMER_NAME = "api-server-cep-v1";

    private final V1JudgeRegistry registry;
    private final DeadLetterPublisher dlq;
    private final JsonMapper jsonMapper;

    public RealtimeInferenceConsumer(V1JudgeRegistry registry, DeadLetterPublisher dlq, JsonMapper jsonMapper) {
        this.registry = registry;
        this.dlq = dlq;
        this.jsonMapper = jsonMapper;
    }

    @KafkaListener(
            topics = "${app.kafka.topic.posture-inference-v1:posture.inference.v1}",
            groupId = "${app.kafka.posture-inference-v1-group:api-server-cep-v1}",
            concurrency = "${app.kafka.posture-inference-concurrency:3}")
    public void onMessage(ConsumerRecord<String, String> record) {
        String error = handle(record.value());
        if (error != null) {
            dlq.publish(CONSUMER_NAME, record.topic(), record.partition(), record.offset(), record.key(),
                    error, record.value());
        }
    }

    /** @return DLQ로 보낼 이유, 정상 처리면 null */
    String handle(String rawValue) {
        Map<String, Object> msg;
        try {
            msg = jsonMapper.readValue(rawValue, Map.class);
        } catch (Exception exc) {
            return "JSON 파싱 실패: " + exc.getMessage();
        }
        if (msg == null) {
            return "빈 메시지";
        }
        Object sid = msg.get("session_id");
        Object kind = msg.get("kind");
        if (!"1.0".equals(msg.get("schema_version")) || !(sid instanceof String sessionId) || sessionId.isBlank()
                || !(kind instanceof String k)) {
            return "봉투 형식 오류(schema_version 1.0·session_id·kind 필요)";
        }
        String userId = msg.get("user_id") instanceof String u ? u : null;
        @SuppressWarnings("unchecked")
        Map<String, Object> body = msg.get("body") instanceof Map<?, ?> b ? (Map<String, Object>) b : null;
        if (body == null) {
            return "body 없음";
        }
        try {
            switch (k) {
                case "session_started" -> registry.sessionStarted(sessionId, userId, body);
                case "observation" -> {
                    String skipped = registry.observation(sessionId, userId, body);
                    if (skipped != null) {
                        log.debug("관측 건너뜀 (sessionId={}): {}", sessionId, skipped);
                    }
                }
                case "session_ended" -> registry.sessionEnded(sessionId, userId, body);
                default -> {
                    return "모르는 kind: " + k;
                }
            }
        } catch (IllegalArgumentException exc) {
            return "관측 형식 오류: " + exc.getMessage();
        } catch (RuntimeException exc) {
            log.error("v1 판정 처리 중 예외 (sessionId={})", sessionId, exc);
            return "처리 중 예외: " + exc;
        }
        return null;
    }
}
