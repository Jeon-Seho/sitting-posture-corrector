package org.posegood.api.realtime;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.session.FrameFeatures;
import org.posegood.api.session.SessionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * kafka 경로(계획 0031 1단계, D-57): 받은 구간을 {@code posture.features.v1}로 보내고, 판정은 처리 서비스가 한다.
 *
 * <p>계약: contracts/realtime/kafka-features.v1.schema.json. 봉투의 키는 {@code session_id}라 한 세션의
 * {@code session_started} → {@code features} → {@code session_ended}가 같은 파티션에 순서대로 들어간다.
 * 구간은 앱이 보낸 그대로(프레임마다) 보낸다 — local 경로와 같은 단위(2026-11-10 결정 ①). 본문은 local이 추론에 보내는
 * {@link InferenceRequest}와 같다. 브로커가 받았다고 확인한 뒤에만 반환해 {@code ack}가 「입력 접수」가 되게 한다.
 *
 * <p>세션마다 시작·종료는 한 번만 보낸다. 입출구 서버는 한 대이고 재시작하면 연결이 모두 끊기므로(재연결 없음,
 * ADR 0024) 이 상태는 메모리에 둔다. 판정 결과(관측·사건·진행·알림)는 결과 토픽에서 따로 받는다.
 * 좌표·특징 값은 로그에 남기지 않는다.
 */
final class KafkaPipeline implements MeasurementPipeline, AutoCloseable {
	private static final Logger log = LoggerFactory.getLogger(KafkaPipeline.class);
	/** 끝난 세션을 기억하는 시간(같은 세션으로 다시 연결해도 시작을 다시 보내지 않게). 판정 쪽 상태 TTL과 같다. */
	static final Duration ENDED_RETENTION = Duration.ofHours(6);

	private final SessionService sessions;
	private final Producer<String, String> producer;
	private final String topic;
	private final Json json;
	private final Duration sendTimeout;
	private final long maxSessionMs;
	private final Clock clock;
	private final ConcurrentHashMap<UUID, Live> live = new ConcurrentHashMap<>();
	private volatile AutoCloseable results;

	KafkaPipeline(
		SessionService sessions,
		Producer<String, String> producer,
		String topic,
		Json json,
		Duration sendTimeout,
		Duration maxSession,
		Clock clock) {
		this.sessions = sessions;
		this.producer = producer;
		this.topic = topic;
		this.json = json;
		this.sendTimeout = sendTimeout;
		this.maxSessionMs = maxSession.toMillis();
		this.clock = clock;
	}

	/**
	 * 세션 확인은 local과 같다(주인·종료·기준 자세). 처음 연결이면 {@code session_started}(세션 정책·기준 자세 ID)를 보낸다.
	 * 이미 끝난 세션이면 409 SESSION_ENDED.
	 */
	@Override
	public SessionService.Realtime open(long owner, UUID sessionId) {
		var realtime = sessions.openRealtime(owner, sessionId);
		var session = sessions.require(owner, sessionId);
		return session.locked(
			() -> {
				var state = live.get(sessionId);
				if (state != null) {
					if (state.ended) {
						throw ApiError.ended();
					}
					return realtime;
				}
				var body = new SessionStarted(session.row().policy(), session.row().baselineId(), Frame.DEFAULT);
				send(sessionId, owner, "session_started", body);
				live.put(sessionId, new Live(session.row().baselineId()));
				return realtime;
			});
	}

	/** 구간 하나: 특징 변화량 계산 → {@code features} 발행 → 브로커 확인 뒤 반환. 순서·중복·시간 한도는 local과 같은 오류. */
	@Override
	public Accepted frames(long owner, UUID sessionId, FrameInterval interval, FrameFeatures.Features baseline) {
		var computed = FrameFeatures.interval(interval, baseline);
		var session = sessions.require(owner, sessionId);
		return session.locked(
			() -> {
				var state = live.get(sessionId);
				if (state == null) {
					throw ApiError.lost();
				}
				if (state.ended) {
					throw ApiError.ended();
				}
				if (interval.sequence() <= state.lastSequence || interval.startMs() < state.lastEndMs) {
					throw ApiError.conflict("out-of-order or overlapping interval");
				}
				if (interval.endMs() > maxSessionMs) {
					throw ApiError.limit("session time limit reached");
				}
				var body = new InferenceRequest(
					"2.0",
					"shoulder-relative-deltas-v1",
					state.baselineId,
					interval.sequence(),
					interval.startMs(),
					interval.endMs(),
					Observation.Phase.valueOf(interval.phase().name()),
					computed.deltas() == null
						? InferenceRequest.MeasurementQuality.poor
						: InferenceRequest.MeasurementQuality.good,
					computed.deltas());
				send(sessionId, owner, "features", body);
				if (computed.invalidReason() != null) {
					state.hints.put(interval.sequence(), computed.invalidReason());
				}
				state.lastSequence = interval.sequence();
				state.lastEndMs = interval.endMs();
				state.touched = clock.instant();
				return new Accepted(interval.sequence(), null);
			});
	}

	/**
	 * 종료: {@code session_ended {end_ms}}를 한 번만 보낸다. {@code endMs}가 null(끊김)이거나 마지막 구간보다 앞서면
	 * 마지막 구간 끝을 쓴다(local과 같음). 발행이 실패하면 503 — 다음 종료 요청(앱 end·끊김)에 다시 보낸다.
	 */
	@Override
	public void finish(long owner, UUID sessionId, Long endMs) {
		var state = live.get(sessionId);
		if (state == null || state.ended) {
			return;
		}
		synchronized (state) {
			if (state.ended) {
				return;
			}
			long end = endMs == null ? state.lastEndMs : Math.max(endMs, state.lastEndMs);
			send(sessionId, owner, "session_ended", new SessionEnded(end));
			state.ended = true;
			state.touched = clock.instant();
		}
	}

	@Override
	public boolean local() {
		return false;
	}

	/**
	 * 좌표에서 찾은 판정 불가 사유(예: {@code head_turn}) — 결과 관측의 {@code invalid_reason}에 붙인다. 없으면 null.
	 * 최근 {@link SessionEngine#RETRY_WINDOW}개 구간만 기억한다(결과는 보통 1초 안에 온다).
	 */
	String hint(UUID sessionId, long sequence) {
		var state = live.get(sessionId);
		return state == null ? null : state.hints.get(sequence);
	}

	/** 결과 구독({@link KafkaResults})을 이 파이프라인과 함께 닫는다. */
	void attach(AutoCloseable subscription) {
		this.results = subscription;
	}

	/** 1분마다: 끝난 지(또는 마지막 입력 뒤) 6시간 지난 세션 상태를 지운다. */
	@Scheduled(fixedDelay = 60_000)
	public void evict() {
		var limit = clock.instant().minus(ENDED_RETENTION);
		live.entrySet().removeIf(entry -> entry.getValue().touched.isBefore(limit));
	}

	@Override
	public void close() throws Exception {
		if (results != null) {
			results.close();
		}
		producer.close(Duration.ofSeconds(5));
	}

	/** 봉투에 싸서 키 {@code session_id}로 보내고 브로커 확인을 기다린다. 실패·시간 초과는 503(앱에는 {@code stalled}). */
	private void send(UUID sessionId, long owner, String kind, Object body) {
		var envelope = new Envelope(
			"1.0",
			UUID.randomUUID(),
			sessionId,
			Long.toString(owner),
			clock.instant().truncatedTo(ChronoUnit.MILLIS).toString(),
			kind,
			body);
		try {
			producer.send(new ProducerRecord<>(topic, sessionId.toString(), json.write(envelope)))
				.get(sendTimeout.toMillis(), TimeUnit.MILLISECONDS);
		} catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
			throw unavailable(kind, interrupted);
		} catch (ExecutionException | TimeoutException | RuntimeException failed) {
			throw unavailable(kind, failed);
		}
	}

	private static ApiError unavailable(String kind, Exception cause) {
		log.warn("realtime kafka publish failed: kind={} cause={}", kind, cause.getClass().getSimpleName());
		return new ApiError(503, "PIPELINE_UNAVAILABLE", "measurement pipeline unavailable");
	}

	/** 세션 하나의 발행 상태. 세션 잠금 안에서만 바꾼다(종료는 상태 자체로 잠근다). */
	private final class Live {
		private final UUID baselineId;
		private volatile long lastSequence = -1;
		private volatile long lastEndMs;
		private volatile boolean ended;
		private volatile Instant touched = clock.instant();
		/** 순번 → 판정 불가 힌트. 세션 잠금 안에서 쓰고 구독 스레드가 읽는다. */
		private final Map<Long, String> hints =
			Collections.synchronizedMap(SessionEngine.recent(SessionEngine.RETRY_WINDOW));

		private Live(UUID baselineId) {
			this.baselineId = baselineId;
		}
	}

	/** 공통 봉투(snake_case로 직렬화). */
	record Envelope(
		String schemaVersion,
		UUID messageId,
		UUID sessionId,
		String userId,
		String producedAt,
		String kind,
		Object body) {
	}

	/** {@code session_started} 본문: 세션 정책, 기준 자세 ID, 영상 크기(계약 필수 칸 — 쓰는 곳은 없음). */
	record SessionStarted(Policy policy, UUID baselineId, Frame frame) {
	}

	record Frame(int width, int height) {
		static final Frame DEFAULT = new Frame(640, 480);
	}

	record SessionEnded(long endMs) {
	}
}
