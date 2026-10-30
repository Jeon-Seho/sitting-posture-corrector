package com.posture.api.posture.realtime;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/**
 * (D-36) 처리할 수 없는 메시지를 {@code posture.dlq}로 넘긴다 — 컨슈머는 멈추지 않고 다음 메시지로 간다.
 *
 * <p>DLQ 메시지(JSON): {@code schema_version, failed_at, consumer, source_topic, source_partition, source_offset,
 * key, reason, payload}. payload는 원문 문자열(최대 256KB, 넘으면 잘라내고 {@code payload_truncated=true}).
 * 키는 원본 키(보통 session_id). 다시 넣어 처리하는 도구는 필요해지면 만든다.
 */
@Component
public class DeadLetterPublisher {

	private static final Logger log = LoggerFactory.getLogger(DeadLetterPublisher.class);
	static final int MAX_PAYLOAD_CHARS = 256 * 1024;

	private final KafkaTemplate<String, String> kafkaTemplate;
	private final JsonMapper jsonMapper;
	private final String topic;

	public DeadLetterPublisher(
		KafkaTemplate<String, String> kafkaTemplate,
		JsonMapper jsonMapper,
		@Value("${app.kafka.topic.posture-dlq:posture.dlq}")
		String topic) {
		this.kafkaTemplate = kafkaTemplate;
		this.jsonMapper = jsonMapper;
		this.topic = topic;
	}

	public void publish(String consumer, String sourceTopic, int partition, long offset,
		String key, String reason, String payload) {
		Map<String, Object> envelope = message(consumer, sourceTopic, partition, offset, key, reason, payload,
			Instant.now());
		log.warn("DLQ로 넘김 (consumer={}, {}-{}@{}, key={}): {}", consumer, sourceTopic, partition, offset, key, reason);
		try {
			kafkaTemplate.send(topic, key, jsonMapper.writeValueAsString(envelope)).whenComplete((r, e) -> {
				if (e != null) {
					log.error("DLQ 발행 실패 ({}-{}@{}): {}", sourceTopic, partition, offset, e.getMessage());
				}
			});
		} catch (RuntimeException exc) {
			log.error("DLQ 발행 실패 ({}-{}@{}): {}", sourceTopic, partition, offset, exc.getMessage());
		}
	}

	static Map<String, Object> message(String consumer, String sourceTopic, int partition, long offset,
		String key, String reason, String payload, Instant now) {
		Map<String, Object> envelope = new LinkedHashMap<>();
		envelope.put("schema_version", "1.0");
		envelope.put("failed_at", now.toString());
		envelope.put("consumer", consumer);
		envelope.put("source_topic", sourceTopic);
		envelope.put("source_partition", partition);
		envelope.put("source_offset", offset);
		envelope.put("key", key);
		envelope.put("reason", reason);
		boolean truncated = payload != null && payload.length() > MAX_PAYLOAD_CHARS;
		envelope.put("payload", truncated ? payload.substring(0, MAX_PAYLOAD_CHARS) : payload);
		envelope.put("payload_truncated", truncated);
		return envelope;
	}
}
