package com.posture.api.report;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import com.posture.api.posture.realtime.DeadLetterPublisher;

import tools.jackson.databind.json.JsonMapper;

/**
 * (D-30, D-51) 판정 결과 저장 — {@code posture.episodes.v1}을 따로 구독해({@code report-store-v1}) V2.3 결과 테이블에 기록한다.
 *
 * <p>판정(judge-v1)과 그룹이 달라 DB가 느리거나 멈춰도 판정·발행은 영향이 없다(v4 장애 격리). 판정 패키지의 클래스는
 * 쓰지 않고 Kafka 메시지만 읽는다 — 나중에 report 서비스로 떼어 낼 때 그대로 옮긴다(v4 D8). 키가 session_id라 한 세션의
 * 메시지는 한 파티션에서 순서대로 온다.
 * <ul>
 *   <li>progress는 건너뛴다(저장할 것 없음). 처음 시작하면 최신 위치부터 읽는다(예전 시험 메시지를 다시 넣지 않도록).</li>
 *   <li>메시지 형식 오류·DB 제약 위반 → {@code posture.dlq}로 넘기고 다음 메시지.</li>
 *   <li>DB 연결 실패 등 → 예외를 던져 같은 메시지를 다시 받는다({@link ReportStoreConfig}의 재시도, 메시지는 Kafka에 남음).</li>
 * </ul>
 */
@Component
public class EpisodesStoreConsumer {

	private static final Logger log = LoggerFactory.getLogger(EpisodesStoreConsumer.class);
	static final String CONSUMER_NAME = "report-store-v1";

	private final EpisodeStoreService service;
	private final DeadLetterPublisher dlq;
	private final JsonMapper jsonMapper;
	private final AtomicLong received = new AtomicLong();
	private final AtomicLong progressSkipped = new AtomicLong();
	private final AtomicLong deadLettered = new AtomicLong();
	private final AtomicLong dbFailures = new AtomicLong();
	private final AtomicReference<String> lastError = new AtomicReference<>();

	public EpisodesStoreConsumer(EpisodeStoreService service, DeadLetterPublisher dlq, JsonMapper jsonMapper) {
		this.service = service;
		this.dlq = dlq;
		this.jsonMapper = jsonMapper;
	}

	@KafkaListener(
		id = CONSUMER_NAME,
		topics = "${app.kafka.topic.posture-episodes-v1:posture.episodes.v1}",
		groupId = "${report.store.group:report-store-v1}",
		concurrency = "${report.store.concurrency:1}",
		autoStartup = "${report.store.enabled:true}",
		containerFactory = ReportStoreConfig.FACTORY,
		properties = {"auto.offset.reset=latest"})
	public void onMessage(ConsumerRecord<String, String> record) {
		String error = handle(record.value());
		if (error != null) {
			deadLettered.incrementAndGet();
			dlq.publish(CONSUMER_NAME, record.topic(), record.partition(), record.offset(), record.key(),
				error, record.value());
		}
	}

	/**
	 * @return DLQ로 보낼 이유, 정상 처리면 null
	 * @throws StoreUnavailableException DB 장애 — 같은 메시지를 다시 받아야 함
	 */
	@SuppressWarnings("unchecked")
	String handle(String rawValue) {
		received.incrementAndGet();
		EpisodeDecision decision;
		try {
			decision = EpisodeDecision.fromEnvelope(jsonMapper.readValue(rawValue, Map.class));
		} catch (IllegalArgumentException exc) {
			return exc.getMessage();
		} catch (Exception exc) {
			return "JSON 파싱 실패: " + exc.getMessage();
		}
		if (decision == null) {
			progressSkipped.incrementAndGet();
			return null;
		}
		try {
			service.apply(decision);
			return null;
		} catch (DataIntegrityViolationException exc) {
			lastError.set(exc.getMessage());
			return "DB 제약 위반: " + exc.getMostSpecificCause().getMessage();
		} catch (DataAccessException exc) {
			dbFailures.incrementAndGet();
			lastError.set(exc.getMessage());
			log.warn("판정 결과 저장 실패 — 다시 시도 (session={}, kind={}): {}", decision.sessionId(), decision.kind(),
				exc.getMessage());
			throw new StoreUnavailableException(exc);
		} catch (IllegalArgumentException exc) {
			return exc.getMessage();
		}
	}

	public Map<String, Object> status() {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("consumer", CONSUMER_NAME);
		status.put("received", received.get());
		status.put("progressSkipped", progressSkipped.get());
		status.put("deadLettered", deadLettered.get());
		status.put("dbFailures", dbFailures.get());
		status.put("lastError", lastError.get());
		status.putAll(service.status());
		return status;
	}

	/** DB 장애로 저장하지 못함 — 컨테이너가 같은 메시지를 다시 넘기게 던진다. */
	public static class StoreUnavailableException extends RuntimeException {
		StoreUnavailableException(Throwable cause) {
			super(cause.getMessage(), cause);
		}
	}
}
