package org.posegood.api.realtime;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiFunction;

import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.common.errors.WakeupException;
import org.posegood.api.common.Json;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.SessionView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;

import tools.jackson.databind.JsonNode;

/**
 * kafka 경로 결과 구독(계획 0031 1단계, D-57): {@code posture.episodes.v1}·{@code posture.alerts.v1}을 받아 앱 메시지로 바꿔
 * {@link PipelineResult} 이벤트로 낸다. 판정은 하지 않는다 — 처리 서비스가 낸 값을 옮길 뿐이다.
 *
 * <ul>
 *   <li>{@code observation} → {@code observation}(관측 4.0). 판정 불가 사유는 좌표에서 찾은 힌트({@code head_turn})를
 *       local과 같은 규칙으로 붙인다({@code SessionEngine.invalidReason}).</li>
 *   <li>{@code decision} → {@code decision}. {@code session_ended}면 종료(임시 규칙 — 저장 완료 이벤트 D-67 전).</li>
 *   <li>{@code progress} → {@code progress}. 멈춘 이유는 그 세션의 마지막 관측으로(local {@code pausedReason}과 같음).</li>
 *   <li>{@code alerts.v1} {@code alert} → {@code alert} 그대로(알림 켜짐·재전송은 판정 결과 저장이 이미 거름).</li>
 *   <li>측정불가(판정 불가·자리 비움)가 이어진 시간을 관측으로 세어 한도에 닿으면 끝내라고 알린다(local과 같은 규칙).</li>
 * </ul>
 *
 * <p>입출구 서버마다 컨슈머 그룹을 따로 두고(모든 결과를 받음) 처음엔 최신 위치부터 읽는다 — 결과는 연결이 있는 동안만 쓸모가
 * 있고 재연결은 없다(ADR 0024). 깨진 메시지는 건너뛴다(로그에 좌표·본문을 남기지 않음).
 */
final class KafkaResults implements AutoCloseable {
	private static final Logger log = LoggerFactory.getLogger(KafkaResults.class);
	/** 결과가 오지 않는 세션 상태를 지우는 시간. */
	private static final long FORGET_NANOS = Duration.ofHours(6).toNanos();

	private final Consumer<String, String> consumer;
	private final String episodesTopic;
	private final String alertsTopic;
	private final Json json;
	private final ApplicationEventPublisher events;
	private final BiFunction<UUID, Long, String> hints;
	private final long unmeasurableTimeoutMs;
	private final ConcurrentHashMap<UUID, Live> live = new ConcurrentHashMap<>();
	private volatile boolean running;
	private Thread thread;

	KafkaResults(
		Consumer<String, String> consumer,
		String episodesTopic,
		String alertsTopic,
		Json json,
		ApplicationEventPublisher events,
		BiFunction<UUID, Long, String> hints,
		Duration unmeasurableTimeout) {
		this.consumer = consumer;
		this.episodesTopic = episodesTopic;
		this.alertsTopic = alertsTopic;
		this.json = json;
		this.events = events;
		this.hints = hints;
		this.unmeasurableTimeoutMs = unmeasurableTimeout.toMillis();
	}

	/** 구독 스레드를 시작한다. */
	void start() {
		running = true;
		thread = new Thread(this::run, "realtime-kafka-results");
		thread.setDaemon(true);
		thread.start();
	}

	private void run() {
		try {
			consumer.subscribe(List.of(episodesTopic, alertsTopic));
			while (running) {
				for (var record : consumer.poll(Duration.ofMillis(500))) {
					handle(record.topic(), record.value());
				}
			}
		} catch (WakeupException stopping) {
			// close()가 깨웠다.
		} catch (RuntimeException failed) {
			log.error("realtime kafka results stopped: {}", failed.getClass().getSimpleName());
		} finally {
			consumer.close(Duration.ofSeconds(5));
		}
	}

	@Override
	public void close() {
		running = false;
		consumer.wakeup();
		if (thread != null) {
			try {
				thread.join(5000);
			} catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
			}
		}
	}

	/** 메시지 하나를 앱 메시지로 바꿔 이벤트로 낸다. 형식이 틀리면 건너뛴다. */
	void handle(String topic, String value) {
		try {
			var envelope = json.mapper().readTree(value);
			var sessionId = UUID.fromString(Json.text(envelope.path("session_id")));
			String kind = Json.text(envelope.path("kind"));
			var body = envelope.path("body");
			if (alertsTopic.equals(topic)) {
				if ("alert".equals(kind)) {
					publish(sessionId, new RealtimeMessages.V2.Alert("alert", body.path("event_id").asLong(),
						Json.text(body.path("kind")), Json.text(body.path("deviation_type"))), null, null, null);
				}
				return;
			}
			switch (kind) {
				case "observation" -> observation(sessionId, body);
				case "decision" -> decision(sessionId, body);
				case "progress" -> progress(sessionId, body);
				default -> log.debug("realtime kafka result kind skipped: {}", kind);
			}
		} catch (RuntimeException broken) {
			log.warn("realtime kafka result skipped: topic={} cause={}", topic, broken.getClass().getSimpleName());
		}
		forgetIdle();
	}

	private void observation(UUID sessionId, JsonNode body) {
		long sequence = body.path("sequence").asLong();
		long startMs = body.path("start_ms").asLong();
		long endMs = body.path("end_ms").asLong();
		String phase = Json.text(body.path("phase"));
		boolean valid = body.path("valid").asBoolean();
		var state = live.computeIfAbsent(sessionId, id -> new Live());
		state.phase = phase;
		state.valid = valid;
		state.seenAt = System.nanoTime();
		Observation.V4 push = valid
			? Observation.V4.judged(sequence, Json.text(body.path("posture")),
				body.path("collapse_probability").asDouble(), body.path("hold_ms").asLong(),
				body.path("recovery_ms").asLong())
			: Observation.V4.unjudged(sequence, invalidReason(phase, hints.apply(sessionId, sequence)));
		// 측정불가가 이어진 시간: 판정 불가(running인데 무효)·자리 비움은 더하고, 유효한 측정·쉬기는 0(local과 같음)
		boolean unmeasurable = "away".equals(phase) || ("running".equals(phase) && !valid);
		state.unmeasurableMs = unmeasurable ? state.unmeasurableMs + endMs - startMs : 0;
		Long timeout = null;
		if (unmeasurableTimeoutMs > 0 && !state.timedOut && state.unmeasurableMs >= unmeasurableTimeoutMs) {
			state.timedOut = true;
			timeout = endMs;
		}
		publish(sessionId, new RealtimeMessages.V2.ObservationPush(push), sequence, null, timeout);
	}

	private void decision(UUID sessionId, JsonNode body) {
		var event = json.convert(body.path("event"), SessionView.DecisionEvent.class);
		var summary = json.convert(body.path("summary"), SessionView.Summary.class);
		Long ended = null;
		if ("session_ended".equals(event.kind())) {
			ended = summary.totalMs();
			live.remove(sessionId);
		}
		publish(sessionId, new RealtimeMessages.V2.Decision(event, summary), null, ended, null);
	}

	private void progress(UUID sessionId, JsonNode body) {
		var summary = json.convert(body.path("summary"), SessionView.Summary.class);
		publish(sessionId, new RealtimeMessages.V2.Progress(body.path("last_sequence").asLong(), summary,
			pausedReason(live.get(sessionId))), null, null, null);
	}

	/** local {@code SessionEngine.pausedReason}과 같음: 쉬기·자리 비움이면 그 이름, 판정 불가면 unmeasurable. */
	private static String pausedReason(Live state) {
		if (state == null || state.phase == null) {
			return null;
		}
		if (!"running".equals(state.phase)) {
			return state.phase;
		}
		return state.valid ? null : "unmeasurable";
	}

	/** local {@code SessionEngine.invalidReason}과 같음: 측정 중 고개 돌림 힌트면 head_turn, 그 밖은 unmeasurable. */
	private static String invalidReason(String phase, String hint) {
		return "running".equals(phase) && "head_turn".equals(hint) ? "head_turn" : "unmeasurable";
	}

	private void publish(UUID sessionId, Object message, Long observed, Long endedTotalMs, Long unmeasurableEndMs) {
		var messages = new ArrayList<Object>(1);
		messages.add(message);
		events.publishEvent(new PipelineResult(sessionId, messages, observed, endedTotalMs, unmeasurableEndMs));
	}

	private void forgetIdle() {
		long now = System.nanoTime();
		if (live.size() > 256) {
			live.entrySet().removeIf(entry -> now - entry.getValue().seenAt > FORGET_NANOS);
		}
	}

	/** 세션마다 마지막 관측과 측정불가 누적. 구독 스레드 하나만 쓴다. */
	private static final class Live {
		private String phase;
		private boolean valid;
		private long unmeasurableMs;
		private boolean timedOut;
		private long seenAt = System.nanoTime();
	}
}
