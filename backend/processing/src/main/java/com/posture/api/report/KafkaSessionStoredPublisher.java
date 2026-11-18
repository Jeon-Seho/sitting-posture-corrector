package com.posture.api.report;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/**
 * (D-67) 저장 완료를 {@code posture.stored.v1}(키 = session_id)로 발행한다.
 * 계약: {@code contracts/realtime/kafka-stored.v1.schema.json}.
 *
 * <p>같은 {@code session_ended}를 다시 받으면(재전송) 다시 낸다 — 입출구 서버는 이미 닫은 세션이면 버린다. 저장 스레드를
 * 막지 않도록 전송 완료를 기다리지 않는다. 실패는 로그·횟수로만 남긴다 — 앱은 종료 뒤 {@code stalled}를 받고 10초 뒤
 * 스스로 닫아 세션 조회로 결과를 본다(DB에는 이미 저장됨).
 */
@Component
public class KafkaSessionStoredPublisher implements SessionStoredPublisher {

	private static final Logger log = LoggerFactory.getLogger(KafkaSessionStoredPublisher.class);

	private final KafkaTemplate<String, String> kafkaTemplate;
	private final JsonMapper jsonMapper;
	private final String topic;
	private final AtomicLong failures = new AtomicLong();

	public KafkaSessionStoredPublisher(
		KafkaTemplate<String, String> kafkaTemplate,
		JsonMapper jsonMapper,
		@Value("${app.kafka.topic.posture-stored-v1:posture.stored.v1}")
		String topic) {
		this.kafkaTemplate = kafkaTemplate;
		this.jsonMapper = jsonMapper;
		this.topic = topic;
	}

	/** 봉투째 만든다(계약 stored.v1): 종료 시각(세션 시작 기준 ms)과 바른 자세 시간(ms, 저장한 good_sec의 재료). */
	static Map<String, Object> message(EpisodeDecision decision, Instant now) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("end_ms", decision.timestampMs());
		body.put("good_ms", decision.normalMs());
		Map<String, Object> envelope = new LinkedHashMap<>();
		envelope.put("schema_version", "1.0");
		envelope.put("message_id", UUID.randomUUID().toString());
		envelope.put("session_id", decision.sessionId());
		envelope.put("user_id", decision.userId() == null ? "unknown" : decision.userId());
		envelope.put("produced_at", now.toString());
		envelope.put("kind", "session_stored");
		envelope.put("body", body);
		return envelope;
	}

	@Override
	public void publish(EpisodeDecision decision) {
		String json = jsonMapper.writeValueAsString(message(decision, Instant.now()));
		kafkaTemplate.send(topic, decision.sessionId(), json).whenComplete((result, error) -> {
			if (error != null) {
				failures.incrementAndGet();
				log.error("posture.stored.v1 발행 실패 (sessionId={}): {}", decision.sessionId(), error.getMessage());
			}
		});
	}

	public long failures() {
		return failures.get();
	}
}
