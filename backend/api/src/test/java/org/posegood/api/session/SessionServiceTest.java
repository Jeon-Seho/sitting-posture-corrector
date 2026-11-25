package org.posegood.api.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import org.junit.jupiter.api.Test;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.InferenceRequest;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.contract.SessionView;
import org.posegood.api.engine.SessionEngine;
import org.posegood.api.policy.ThresholdPolicyRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.json.JsonMapper;

/**
 * 측정불가가 이어지면 서버가 그 지점에서 세션을 끝내고 저장한다(2026-10-26 결정). 자정 넘김은 이전 세션을 끝내고
 * 같은 설정으로 새 세션을 만든다(BE-6 ① B안). 세션 조회(S4)는 메모리에 끝난 결과가 없으면 DB로 다시 만든 결과로 답한다
 * (BE-11). 입력은 실시간 v2 좌표 구간({@link SessionService#frames}). DB·추론은 가짜.
 */
class SessionServiceTest {
	private static final long OWNER = 7;
	private static final UUID ID = UUID.fromString("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
	private static final UUID BASELINE = UUID.fromString("9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60");
	private static final Policy POLICY = new Policy(3000, 3000, 60000, 0.7);

	private final SessionRepository repository = mock(SessionRepository.class);
	private final InferenceClient inference = mock(InferenceClient.class);
	private final List<SessionUpdates.Progressed> published = new ArrayList<>();
	/** DB에 끝난 값이 있는 세션(가짜 {@link EndedSessionViews}, 주인은 {@link #OWNER}). */
	private final Map<UUID, SessionView> stored = new HashMap<>();
	private final BaselineRepository baselines = mock(BaselineRepository.class);
	private LiveSessions live;

	private SessionService service(Duration unmeasurableTimeout) {
		return service(unmeasurableTimeout, Duration.ofSeconds(30));
	}

	private SessionService service(Duration unmeasurableTimeout, Duration measurementGrace) {
		ApplicationEventPublisher events = event -> {
			if (event instanceof SessionUpdates.Progressed progressed) {
				published.add(progressed);
			}
		};
		var tx = mock(TransactionTemplate.class);
		when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>)call.getArgument(0)).doInTransaction(null));
		when(inference.infer(any(InferenceRequest.class))).thenAnswer(call -> {
			InferenceRequest request = call.getArgument(0);
			boolean valid = request.measurementQuality() == InferenceRequest.MeasurementQuality.good;
			return new Observation("2.0", request.sequence(), request.startMs(), request.endMs(), request.phase(),
				valid, valid ? 0.1 : 0, Observation.DeviationType.none,
				"synthetic-v1");
		});
		live = new LiveSessions(events, 8, Duration.ofMinutes(30), Duration.ofHours(6));
		var locks = mock(UserLocks.class);
		when(locks.withLock(anyLong(), any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(1)).get());
		var row = new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
			Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
		live.add(new LiveSession(row, new SessionEngine(ID, POLICY)));
		return new SessionService(live, repository, baselines,
			mock(ThresholdPolicyRepository.class), mock(AccountService.class), inference, locks,
			tx, events, (owner, id) -> owner == OWNER ? stored.get(id) : null, Duration.ofHours(24),
			unmeasurableTimeout, measurementGrace);
	}

	/** 합성 기준 좌표(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨). */
	private static final double[][] UPRIGHT = {
		{0.51234, 0.40211}, {0.53011, 0.3712}, {0.49012, 0.372}, {0.56021, 0.39012}, {0.46011, 0.391},
		{0.52, 0.44}, {0.5, 0.44}, {0.66011, 0.62}, {0.36012, 0.62}
	};
	private static final FrameFeatures.Features STANDARD = FrameFeatures.baseline(landmarks());

	private static SessionRequests.Landmarks landmarks() {
		var points = new SessionRequests.Point[9];
		for (int i = 0; i < 9; i++) {
			points[i] = new SessionRequests.Point(UPRIGHT[i][0], UPRIGHT[i][1]);
		}
		return new SessionRequests.Landmarks(points[0], points[1], points[2], points[3], points[4],
			points[5], points[6], points[7], points[8]);
	}

	/** 0.5초 좌표 구간. 판정 가능하면 기준과 같은 자세 1장, 아니면 사람 없는 프레임 1장, 쉬기·자리 비움은 빈 구간. */
	private static FrameInterval interval(long sequence, FrameInterval.Phase phase, boolean valid) {
		long start = sequence * 500;
		List<FrameInterval.Frame> frames = List.of();
		if (phase == FrameInterval.Phase.running) {
			List<List<Double>> joints = null;
			if (valid) {
				joints = new ArrayList<>();
				for (var joint : UPRIGHT) {
					joints.add(List.of(joint[0], joint[1], 0.95));
				}
			}
			frames = List.of(new FrameInterval.Frame(start, joints, null));
		}
		return new FrameInterval("3.0", "keypoints-9-v1", sequence, start, start + 500, phase, frames);
	}

	/** 실시간 v2 구간 하나를 넣고 세션 조회 응답을 돌려준다. */
	private static SessionView feed(SessionService service, UUID id, FrameInterval interval) {
		service.frames(OWNER, id, interval, STANDARD);
		return service.get(OWNER, id);
	}

	@Test
	void flatAndLegacyInputsProduceTheSameObservationsEventsAndFinalSummary() {
		var legacy = compatibilitySequence(false);
		var legacyUpdates = List.copyOf(published);
		published.clear();
		var flat = compatibilitySequence(true);
		assertEquals(legacy, flat);
		assertEquals(legacyUpdates, published);
		assertEquals(10500, flat.summary().totalMs());
		assertEquals(8000, flat.summary().validMs());
		assertEquals(4000, flat.summary().normalMs());
		assertEquals(4000, flat.summary().deviationMs());
		assertEquals(1000, flat.summary().unknownMs());
		assertEquals(500, flat.summary().restMs());
		assertEquals(500, flat.summary().awayMs());
		assertEquals(500, flat.summary().missingMs());
		assertEquals(1, flat.summary().collapseCount());
		assertEquals(1, flat.summary().alertCount());
		assertEquals(List.of("collapse_confirmed", "interrupted", "session_ended"),
			flat.events().stream().map(SessionView.DecisionEvent::kind).toList());
	}

	/** DB·외부 추론은 대역으로 두고 좌표 계산부터 판정·알림·종료 집계까지 같은 합성 시퀀스를 통과시킨다. */
	private SessionView compatibilitySequence(boolean flat) {
		var service = service(Duration.ZERO);
		when(inference.infer(any(InferenceRequest.class))).thenAnswer(call -> {
			InferenceRequest request = call.getArgument(0);
			boolean valid = request.features() != null;
			double score = valid && request.features().headGapDelta() < -0.2 ? 0.8 : 0;
			return new Observation("2.0", request.sequence(), request.startMs(), request.endMs(), request.phase(),
				valid, score, score > 0 ? Observation.DeviationType.forward_slouch : Observation.DeviationType.none,
				"synthetic-v1");
		});
		var mapper = JsonMapper.builder().build();
		for (int sequence = 0; sequence < 20; sequence++) {
			var phase = sequence == 12 ? FrameInterval.Phase.rest
				: sequence == 13 ? FrameInterval.Phase.away : FrameInterval.Phase.running;
			var input = interval(sequence, phase, sequence != 10 && sequence != 11);
			if (sequence >= 2 && sequence <= 9) {
				var points = new ArrayList<List<Double>>();
				for (int joint = 0; joint < 9; joint++) {
					points.add(List.of(UPRIGHT[joint][0], UPRIGHT[joint][1] + (joint < 7 ? 0.1 : 0), 0.95));
				}
				input = new FrameInterval("3.0", "keypoints-9-v1", sequence, input.startMs(), input.endMs(), phase,
					List.of(new FrameInterval.Frame(input.startMs(), points, null)));
			}
			if (sequence == 11) {
				input = new FrameInterval("3.0", "keypoints-9-v1", sequence, input.startMs(), input.endMs(), phase,
					List.of());
			}
			if (flat) {
				var message = mapper.createObjectNode().put("type", "features").put("sequence", sequence)
					.put("start_ms", input.startMs()).put("end_ms", input.endMs()).put("phase", phase.name());
				if (phase == FrameInterval.Phase.running) {
					var frame = input.lastFrame();
					if (frame != null) {
						message.put("t_ms", frame.tMs());
					}
					if (frame == null || frame.p() == null) {
						message.put("phase", "unmeasurable").putNull("p");
					} else {
						message.set("p", mapper.valueToTree(frame.p()));
					}
				}
				input = FrameInterval.readFlat(message);
			}
			feed(service, ID, input);
		}
		service.finish(OWNER, ID, 10500L);
		return service.get(OWNER, ID);
	}

	@Test
	void unmeasurableForTheTimeoutEndsAndStoresTheSessionAtThatPoint() {
		var service = service(Duration.ofSeconds(5));
		feed(service, ID, interval(0, FrameInterval.Phase.running, true));
		// 판정 불가 3초 + 자리 비움 2초 = 5초가 차는 구간에서 끝난다.
		for (long sequence = 1; sequence <= 6; sequence++) {
			assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.running, false)).ended());
		}
		for (long sequence = 7; sequence <= 9; sequence++) {
			assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.away, false)).ended());
		}
		var last = feed(service, ID, interval(10, FrameInterval.Phase.away, false));
		assertTrue(last.ended());
		assertEquals(5500, last.summary().totalMs());
		assertEquals("session_ended", last.events().get(last.events().size() - 1).kind());

		var update = published.get(published.size() - 1);
		assertTrue(update.ended());
		assertEquals("unmeasurable_timeout", update.closedReason());
		verify(repository).close(eq(row()), any(SessionRepository.Closing.class));
	}

	@Test
	void restResetsTheCountAndZeroTurnsTheRuleOff() {
		var service = service(Duration.ofSeconds(5));
		for (long sequence = 0; sequence < 9; sequence++) {
			feed(service, ID, interval(sequence, FrameInterval.Phase.running, false));
		}
		feed(service, ID, interval(9, FrameInterval.Phase.rest, false)); // 쉬기는 초기화
		for (long sequence = 10; sequence < 19; sequence++) {
			assertFalse(feed(service, ID, interval(sequence, FrameInterval.Phase.running, false)).ended());
		}

		published.clear();
		var off = service(Duration.ZERO);
		for (long sequence = 0; sequence < 40; sequence++) {
			assertFalse(feed(off, ID, interval(sequence, FrameInterval.Phase.away, false)).ended());
		}
		assertNull(published.get(published.size() - 1).closedReason());
		verify(repository, never()).close(any(), any());
	}

	@Test
	void midnightRolloverEndsThePreviousSessionAndStartsAFollowingOne() {
		var service = service(Duration.ZERO);
		for (long sequence = 0; sequence < 4; sequence++) {
			feed(service, ID, interval(sequence, FrameInterval.Phase.running, true));
		}
		var midnight = Instant.parse("2026-10-26T15:00:00Z");
		when(repository.find(any(UUID.class))).thenAnswer(call -> new SessionRepository.Stored(2, call.getArgument(0),
			OWNER, POLICY, BASELINE, true, midnight, null, null, 0, 0));

		var result = service.rollover(OWNER, ID, midnight, 1000);
		// 이전 세션: 마지막 구간 끝(2초)에서 끝나 저장되고, 종료 이벤트의 closed 사유는 day_changed다.
		assertEquals(2000, result.ended().totalMs());
		assertEquals(Instant.parse("2026-10-26T01:00:02Z"), result.endedAt());
		assertTrue(service.get(OWNER, ID).ended());
		assertEquals("day_changed", published.get(published.size() - 1).closedReason());
		verify(repository).close(eq(row()), any(SessionRepository.Closing.class));
		// 새 세션: 서버가 만든 ID, 자정에 시작, 이전 세션과 같은 설정. 시간은 0부터, 한도는 받은 값(1초).
		verify(repository).insertFollowing(row(), result.sessionId(), KstTime.of(midnight));
		assertEquals(midnight, result.startedAt());
		var next = service.get(OWNER, result.sessionId());
		assertFalse(next.ended());
		assertEquals(POLICY, next.policy());
		assertEquals(500, feed(service, result.sessionId(), interval(0, FrameInterval.Phase.running, true))
			.summary().totalMs());
		assertEquals(429, assertThrows(ApiError.class,
			() -> feed(service, result.sessionId(), interval(2, FrameInterval.Phase.running, true))).status());
		// 이미 끝난 세션은 다시 넘기지 않는다.
		assertEquals("SESSION_ENDED", assertThrows(ApiError.class,
			() -> service.rollover(OWNER, ID, midnight, 1000)).code());
	}

	@Test
	void kafkaMidnightRolloverOnlyMarksThePreviousEndedAndCreatesTheFollowingRow() {
		// (D-104) kafka: 이전 세션 판정·저장은 처리 서비스 몫 — 이 서버 엔진을 끝내거나 결과 테이블에 쓰지 않는다
		var service = service(Duration.ZERO);
		var latest = new SessionView.Summary(1500, 1500, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0.0, null, null);
		service.useResults(id -> Optional.of(new SessionResults.Snapshot(2, latest, List.of(), false)));
		var midnight = Instant.parse("2026-10-26T15:00:00Z");
		when(repository.find(any(UUID.class))).thenAnswer(call -> new SessionRepository.Stored(2, call.getArgument(0),
			OWNER, POLICY, BASELINE, true, midnight, null, null, 0, 0));

		var result = service.followFromKafka(OWNER, ID, midnight, 1000, 2000);
		assertEquals(latest, result.ended()); // kafka로 받은 마지막 요약
		assertEquals(Instant.parse("2026-10-26T01:00:02Z"), result.endedAt()); // 시작 + 이전 세션 종료 위치
		verify(repository, never()).close(any(), any());
		verify(repository).insertFollowing(row(), result.sessionId(), KstTime.of(midnight));
		assertEquals(midnight, result.startedAt());
		assertFalse(service.get(OWNER, result.sessionId()).ended());
		assertEquals(POLICY, service.get(OWNER, result.sessionId()).policy());
	}

	@Test
	void sessionViewFallsBackToTheEndedSessionInTheDatabase() {
		var service = service(Duration.ZERO);
		feed(service, ID, interval(0, FrameInterval.Phase.running, true));
		var fromDb = new SessionView("1.0", ID, POLICY, SessionView.TIMER_POLICY, true, -1,
			new SessionView.Summary(4000, 4000, 4000, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0.0, null, null), List.of());

		// 진행 중이고 DB에 끝난 값이 없으면 메모리 그대로.
		assertEquals(0, service.get(OWNER, ID).lastSequence());
		// 메모리는 끝나지 않았는데 DB에 끝난 값이 있으면(kafka 모드: io-api 메모리는 판정하지 않음) DB 값.
		stored.put(ID, fromDb);
		assertEquals(fromDb, service.get(OWNER, ID));
		// 남의 세션은 DB 값이 있어도 404.
		assertEquals("SESSION_NOT_FOUND", assertThrows(ApiError.class, () -> service.get(OWNER + 1, ID)).code());

		// 메모리에서 빠져도(재시작·보관 시간 지남) DB 값.
		live.remove(ID, "session_lost");
		assertEquals(fromDb, service.get(OWNER, ID));
		// DB에도 끝난 값이 없으면 404 SESSION_LOST.
		stored.clear();
		when(repository.find(ID)).thenReturn(row());
		assertEquals("SESSION_LOST", assertThrows(ApiError.class, () -> service.get(OWNER, ID)).code());
	}

	@Test
	void anEndedSessionInMemoryIsAnsweredFromMemory() {
		var service = service(Duration.ZERO);
		feed(service, ID, interval(0, FrameInterval.Phase.running, true));
		// 실시간 종료(WS end, local). S3(REST 종료)는 지울 예정이라 쓰지 않는다.
		service.finish(OWNER, ID, 500L);
		var view = service.get(OWNER, ID);
		assertTrue(view.ended());
		stored.put(ID, new SessionView("1.0", ID, POLICY, SessionView.TIMER_POLICY, true, -1, view.summary(),
			List.of()));
		// 메모리의 끝난 결과가 더 정확하다(사건 종류·마지막 구간 번호가 그대로).
		assertEquals(view, service.get(OWNER, ID));
	}

	/** (D-57, 11/12 DB/BE 합의) kafka 경로는 이 서버 엔진이 판정하지 않으므로 ①(엔진의 끝난 결과)을 건너뛰고 DB 값으로 답한다. */
	@Test
	void kafkaModeSkipsTheEngineEndedViewAndAnswersFromTheDatabase() {
		var service = service(Duration.ZERO);
		feed(service, ID, interval(0, FrameInterval.Phase.running, true));
		service.finish(OWNER, ID, 500L);
		var fromDb = new SessionView("1.0", ID, POLICY, SessionView.TIMER_POLICY, true, -1,
			service.get(OWNER, ID).summary(), List.of());
		stored.put(ID, fromDb);
		service.useResults(id -> Optional.empty());
		assertEquals(fromDb, service.get(OWNER, ID));
	}

	private static SessionRepository.Stored row() {
		return new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
			Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
	}

	/** (D-57 ⑧) kafka 경로: 세션 조회는 받아 둔 마지막 결과로 요약·사건·순번·종료를 채운다(정책은 그대로). 없으면 엔진 값. */
	@Test
	void getOverlaysTheLatestKafkaResult() {
		var service = service(Duration.ZERO);
		var engine = service.get(OWNER, ID);
		assertEquals(-1, engine.lastSequence());

		var summary = new SessionView.Summary(85000, 80000, 70000, 10000, 0, 5000, 0, 0, 1, 1, 170, 0.875, 42.0,
			null, null);
		var event = new SessionView.DecisionEvent("1.0", ID, 1, "collapse_confirmed", 3000, 0, 0, "forward_head",
			null);
		service.useResults(id -> id.equals(ID)
			? Optional.of(new SessionResults.Snapshot(169, summary, List.of(event), true))
			: Optional.empty());
		var view = service.get(OWNER, ID);
		assertEquals(169, view.lastSequence());
		assertEquals(summary, view.summary());
		assertEquals(List.of(event), view.events());
		assertTrue(view.ended());
		assertEquals(engine.policy(), view.policy());
	}

	private static final UUID OTHER = UUID.fromString("5d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6");

	/** 로그인은 기기마다 되지만 측정은 계정당 하나다: 다른 기기의 새 세션(S1)은 409 MEASUREMENT_IN_PROGRESS. */
	@Test
	void anotherDeviceCannotStartWhileOneIsMeasuring() {
		var service = service(Duration.ZERO);
		var refused = assertThrows(ApiError.class,
			() -> service.create(OWNER, OTHER, new SessionRequests.Create(POLICY, BASELINE)));
		assertEquals(409, refused.status());
		assertEquals("MEASUREMENT_IN_PROGRESS", refused.code());
		verify(repository, never()).insert(anyLong(), any(), anyLong(), anyLong(), anyBoolean(), any());
		// 다른 계정은 막지 않는다.
		assertNull(live.measuringOther(OWNER + 1, OTHER, Duration.ofSeconds(30).toNanos()));
		// 측정 중인 기기가 끝내면 다른 기기가 시작할 수 있다.
		service.finish(OWNER, ID, 0L);
		assertNull(live.measuringOther(OWNER, OTHER, Duration.ofSeconds(30).toNanos()));
	}

	/** S1만 하고 연결하지 않은 세션은 유예가 지나면 막지 않는다. 연결된 세션은 끝날 때까지 다른 연결을 막는다. */
	@Test
	void onlyAConnectedOrJustCreatedSessionBlocksOtherDevices() {
		var service = service(Duration.ZERO, Duration.ZERO);
		assertNull(live.measuringOther(OWNER, OTHER, 0));
		when(baselines.find(OWNER, BASELINE)).thenReturn(new BaselineRepository.Stored(1, OWNER,
			Instant.parse("2026-10-26T00:00:00Z"), landmarks()));
		service.openRealtime(OWNER, ID);
		assertEquals(ID, live.measuringOther(OWNER, OTHER, 0).id());

		var otherRow = new SessionRepository.Stored(2, OTHER, OWNER, POLICY, BASELINE, true,
			Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
		live.add(new LiveSession(otherRow, new SessionEngine(OTHER, POLICY)));
		assertEquals("MEASUREMENT_IN_PROGRESS",
			assertThrows(ApiError.class, () -> service.openRealtime(OWNER, OTHER)).code());

		service.finish(OWNER, ID, null); // 연결이 끊김
		service.openRealtime(OWNER, OTHER);
		assertEquals(OTHER, live.measuringOther(OWNER, ID, 0).id());
	}

	/**
	 * (D-98) kafka 경로는 서버 엔진이 끝나지 않는다. 종료를 처리 서비스로 넘기면({@link SessionService#release}) S1 뒤
	 * 유예 안이어도 측정 중으로 보지 않고, 끝난 세션에 다시 연결하면 측정 중 표시 없이 409 SESSION_ENDED다.
	 */
	@Test
	void aReleasedKafkaSessionNoLongerBlocksAndCannotBeReopened() {
		var service = service(Duration.ZERO); // 유예 30초 — 방금 만든 세션이라 연결이 없어도 유예 안
		when(baselines.find(OWNER, BASELINE)).thenReturn(new BaselineRepository.Stored(1, OWNER,
			Instant.parse("2026-10-26T00:00:00Z"), landmarks()));
		long grace = Duration.ofSeconds(30).toNanos();
		service.openRealtime(OWNER, ID);
		assertEquals(ID, live.measuringOther(OWNER, OTHER, grace).id());

		service.release(OWNER + 1, ID); // 남의 세션은 건드리지 않는다
		assertEquals(ID, live.measuringOther(OWNER, OTHER, grace).id());

		service.release(OWNER, ID);
		assertFalse(live.get(ID).engine().ended()); // 엔진은 그대로(판정은 처리 서비스)
		assertNull(live.measuringOther(OWNER, OTHER, grace));
		assertEquals("SESSION_ENDED", assertThrows(ApiError.class, () -> service.openRealtime(OWNER, ID)).code());
		assertNull(live.measuringOther(OWNER, OTHER, grace));
	}

	/** (D-98) 연결이 떨어지면 측정 중 표시를 내린다 — 종료가 넘어가지 않았어도 S1 뒤 유예가 지나면 막지 않는다. */
	@Test
	void aDisconnectedSessionStopsBlockingAfterTheGrace() {
		var service = service(Duration.ZERO, Duration.ZERO);
		when(baselines.find(OWNER, BASELINE)).thenReturn(new BaselineRepository.Stored(1, OWNER,
			Instant.parse("2026-10-26T00:00:00Z"), landmarks()));
		service.openRealtime(OWNER, ID);
		assertEquals(ID, live.measuringOther(OWNER, OTHER, 0).id());
		service.disconnected(OWNER + 1, ID); // 남의 세션은 건드리지 않는다
		assertEquals(ID, live.measuringOther(OWNER, OTHER, 0).id());
		service.disconnected(OWNER, ID);
		assertNull(live.measuringOther(OWNER, OTHER, 0));
	}

	/**
	 * (D-98) 메모리 정리도 종료를 넘긴 세션을 끝난 세션으로 본다: 자리가 모자라면 먼저 빠지고, 끝난 세션 보관 시간을
	 * 따른다(전에는 엔진이 끝나지 않아 방치 6시간까지 남고, 한도가 차면 모든 새 측정이 429였다).
	 */
	@Test
	void aReleasedSessionMakesRoomAndFollowsTheEndedRetention() {
		ApplicationEventPublisher events = event -> { };
		var row = new SessionRepository.Stored(1, ID, OWNER, POLICY, BASELINE, true,
			Instant.parse("2026-10-26T01:00:00Z"), null, null, 0, 0);
		var sessions = new LiveSessions(events, 1, Duration.ZERO, Duration.ofHours(6));
		var session = new LiveSession(row, new SessionEngine(ID, POLICY));
		sessions.add(session);
		assertEquals(429, assertThrows(ApiError.class, sessions::ensureRoom).status());
		sessions.evict();
		assertEquals(session, sessions.get(ID)); // 진행 중이면 6시간 기준

		session.release();
		sessions.evict();
		assertNull(sessions.get(ID)); // 끝난 세션 기준(여기서는 0)

		sessions.add(session);
		sessions.ensureRoom();
		assertNull(sessions.get(ID));
	}
}
