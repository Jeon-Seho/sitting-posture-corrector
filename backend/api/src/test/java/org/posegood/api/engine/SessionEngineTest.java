package org.posegood.api.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Observation;
import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;

/**
 * 판정 엔진 단위 시험(옛 CEP 시험과 같은 입력·기대값 포함).
 *
 * 손으로 만든 합성 출력만 쓴다. 앞의 16개는 예전 CEP 엔진 시험과 입력·기대값이 같아서
 * API 안의 판정이 CEP와 같게 동작하는지 확인한다(ADR 0020).
 */
class SessionEngineTest {
	private static final Policy DEFAULTS = new Policy(3000, 2000, 60000, 0.7);

	private SessionEngine engine;
	private long sequence;

	@BeforeEach
	void setup() {
		engine = new SessionEngine(UUID.randomUUID(), DEFAULTS);
		sequence = 0;
	}

	private Observation observation(
		long sequence, long from, long to, double probability, boolean valid, Observation.Phase phase) {
		return new Observation(
			"2.0",
			sequence,
			from,
			to,
			phase,
			valid,
			probability,
			Observation.DeviationType.forward_slouch,
			"synthetic-v1");
	}

	private SessionView feed(long from, long to, double probability) {
		return phase(from, to, probability, true, Observation.Phase.running);
	}

	private SessionView phase(long from, long to, double probability, boolean valid, Observation.Phase phase) {
		var result = engine.view();
		while (from < to) {
			long next = Math.min(to, from + 1000);
			result = engine.accept(observation(sequence++, from, next, probability, valid, phase));
			from = next;
		}
		return result;
	}

	private long count(String kind) {
		return engine.view().events().stream().filter(event -> event.kind().equals(kind)).count();
	}

	@Test
	void threeSecondBeforeExactAfterAndFirstAlertOnce() {
		assertEquals(0, feed(0, 2999, 0.9).summary().collapseCount());
		assertEquals(1, feed(2999, 3000, 0.9).summary().collapseCount());
		assertEquals(1, feed(3000, 3001, 0.9).summary().alertCount());
		assertEquals(1, count("collapse_confirmed"));
		assertEquals(3000, engine.view().events().get(0).timestampMs());
	}

	@Test
	void separateTwoPointNineSecondRunsNeverSum() {
		feed(0, 2900, 0.9);
		feed(2900, 3000, 0.1);
		feed(3000, 5900, 0.9);
		assertEquals(0, engine.view().summary().collapseCount());
	}

	@Test
	void reminderSixtySecondBoundary() {
		feed(0, 62999, 0.9);
		assertEquals(1, engine.view().summary().alertCount());
		feed(62999, 63000, 0.9);
		assertEquals(2, engine.view().summary().alertCount());
		feed(63000, 63001, 0.9);
		assertEquals(2, engine.view().summary().alertCount());
		assertEquals(1, count("reminder"));
	}

	@Test
	void recoveryBoundaryAndReturnToDeviationReset() {
		feed(0, 3000, 0.9);
		feed(3000, 4999, 0.1);
		assertEquals(0, count("recovery_confirmed"));
		feed(4999, 5000, 0.1);
		assertEquals(1, count("recovery_confirmed"));
		assertEquals(2000, engine.view().summary().meanRecoveryMs());
	}

	@Test
	void interruptedRecoveryDoesNotSum() {
		feed(0, 3000, 0.9);
		feed(3000, 4900, 0.1);
		feed(4900, 5000, 0.9);
		feed(5000, 6900, 0.1);
		assertEquals(0, count("recovery_confirmed"));
		feed(6900, 7000, 0.1);
		assertEquals(1, count("recovery_confirmed"));
	}

	@Test
	void customFrozenTimesAndThresholdAreApplied() {
		engine = new SessionEngine(UUID.randomUUID(), new Policy(4000, 3500, 7000, 0.8));
		feed(0, 1000, 0.75);
		feed(1000, 4999, 0.9);
		assertEquals(0, count("collapse_confirmed"));
		feed(4999, 5000, 0.9);
		assertEquals(1, count("collapse_confirmed"));
		feed(5000, 11999, 0.9);
		assertEquals(1, engine.view().summary().alertCount());
		feed(11999, 12000, 0.9);
		assertEquals(2, engine.view().summary().alertCount());
		feed(12000, 15499, 0.1);
		assertEquals(0, count("recovery_confirmed"));
		feed(15499, 15500, 0.1);
		assertEquals(1, count("recovery_confirmed"));
	}

	@Test
	void restExcludedFromIntervalAcrossSameSession() {
		feed(0, 3000, 0.9);
		feed(3000, 5000, 0.1);
		phase(5000, 15000, 0.9, true, Observation.Phase.rest);
		feed(15000, 18000, 0.9);
		var stats = engine.view().summary();
		assertEquals(10000, stats.restMs());
		assertEquals(8000, stats.validMs());
		assertEquals(5000, stats.meanIntervalMs());
		assertEquals(1, stats.intervalCount());
		assertEquals(900, stats.eventsPerHour());
		assertEquals(0.25, stats.keepRate());
	}

	@Test
	void awayPoorAndMissingExcludedAndNotRecovered() {
		feed(0, 3000, 0.9);
		phase(3000, 6000, 0.9, true, Observation.Phase.away);
		phase(6000, 9000, 0.9, false, Observation.Phase.running);
		feed(12000, 15000, 0.9);
		var stats = engine.view().summary();
		assertEquals(3000, stats.awayMs());
		assertEquals(3000, stats.unknownMs());
		assertEquals(3000, stats.missingMs());
		assertEquals(6000, stats.validMs());
		assertEquals(3000, stats.meanIntervalMs());
		assertNull(stats.meanRecoveryMs());
		assertEquals(0, count("recovery_confirmed"));
		assertEquals(
			stats.totalMs(),
			stats.validMs() + stats.awayMs() + stats.unknownMs() + stats.missingMs() + stats.restMs());
	}

	@Test
	void missingBreaksCandidateAndDoesNotBecomeNormal() {
		feed(0, 2900, 0.9);
		feed(6000, 8900, 0.9);
		assertEquals(0, count("collapse_confirmed"));
		assertEquals(3100, engine.view().summary().missingMs());
		assertEquals(0, engine.view().summary().normalMs());
	}

	@Test
	void missingSequenceBreaksCandidateWithoutInventingDuration() {
		engine.accept(observation(0, 0, 1500, 0.9, true, Observation.Phase.running));
		engine.accept(observation(2, 1500, 3000, 0.9, true, Observation.Phase.running));
		assertEquals(0, count("collapse_confirmed"));
		assertEquals(0, engine.view().summary().missingMs());
	}

	@Test
	void validZeroAndSingleEventHaveUnavailableStatistics() {
		phase(0, 3000, 0.9, true, Observation.Phase.rest);
		var summary = engine.view().summary();
		assertNull(summary.keepRate());
		assertNull(summary.eventsPerHour());
		assertNull(summary.meanIntervalMs());
		feed(3000, 6000, 0.9);
		assertNull(engine.view().summary().meanIntervalMs());
	}

	@Test
	void duplicateIdempotentConflictOutOfOrderAndOverlapDoNotMutate() {
		var first = observation(0, 0, 1000, 0.9, true, Observation.Phase.running);
		var before = engine.accept(first);
		assertEquals(before, engine.accept(first));
		assertThrows(
			ApiError.class,
			() -> engine.accept(observation(0, 0, 1000, 0.1, true, Observation.Phase.running)));
		assertThrows(
			ApiError.class,
			() -> engine.accept(observation(1, 999, 1500, 0.9, true, Observation.Phase.running)));
		assertEquals(before, engine.view());
	}

	@Test
	void sessionBoundaryNeverProducesCycleIntervalOrCarryOverCandidate() {
		feed(0, 3000, 0.9);
		engine.end(3000);
		var second = new SessionEngine(UUID.randomUUID(), DEFAULTS);
		second.accept(observation(0, 0, 1000, 0.9, true, Observation.Phase.running));
		assertEquals(0, second.view().summary().collapseCount());
		assertNull(second.view().summary().meanIntervalMs());
	}

	@Test
	void endIsIdempotentAndDoesNotPretendRecovery() {
		feed(0, 3000, 0.9);
		var result = engine.end(3000);
		assertEquals(result, engine.end(3000));
		assertEquals(409, assertThrows(ApiError.class, () -> engine.end(2999)).status());
		var late = observation(sequence, 3000, 4000, 0.9, true, Observation.Phase.running);
		assertEquals("SESSION_ENDED", assertThrows(ApiError.class, () -> engine.accept(late)).code());
		assertEquals(0, count("recovery_confirmed"));
		assertEquals(1, count("session_ended"));
		assertEquals(result, engine.view());
	}

	@Test
	void concurrentRetriesAreExactlyOnce() throws Exception {
		feed(0, 2000, 0.9);
		var input = observation(sequence, 2000, 3000, 0.9, true, Observation.Phase.running);
		var pool = Executors.newFixedThreadPool(4);
		try {
			var futures = new ArrayList<Future<SessionView>>();
			for (int i = 0; i < 12; i++) {
				futures.add(pool.submit(() -> engine.accept(input)));
			}
			for (var future : futures) {
				assertEquals(1, future.get().summary().collapseCount());
			}
		} finally {
			pool.shutdown(); // Java 17: ExecutorService is not AutoCloseable.
			assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
		}
		assertEquals(3000, engine.view().summary().validMs());
		assertEquals(1, engine.view().summary().alertCount());
	}

	@Test
	void timeLimitPreservesRecentDuplicateAndEndAfterTheLastAllowedInput() {
		// 최대 측정 시간(설정값) 10,000초: 1초 구간 10,000개까지 받고 그 뒤는 429.
		engine = new SessionEngine(UUID.randomUUID(), DEFAULTS, 10_000_000);
		for (int index = 0; index < 10000; index++) {
			engine.accept(
				observation(
					index, index * 1000L, (index + 1) * 1000L, 0.1, true, Observation.Phase.running));
		}
		var full = engine.view();
		assertEquals(9999, full.lastSequence());
		var over = observation(10000, 10000000, 10001000, 0.1, true, Observation.Phase.running);
		assertEquals(429, assertThrows(ApiError.class, () -> engine.accept(over)).status());
		assertEquals(full, engine.view());
		var last = observation(9999, 9999000, 10000000, 0.1, true, Observation.Phase.running);
		assertEquals(full, engine.accept(last));
		var changed = observation(9999, 9999000, 10000000, 0.9, true, Observation.Phase.running);
		assertEquals(409, assertThrows(ApiError.class, () -> engine.accept(changed)).status());
		var ended = engine.end(10000000);
		assertEquals(ended, engine.end(10000000));
		assertEquals(ended, engine.accept(last));
		assertEquals(1, count("session_ended"));
		assertEquals(10000000, ended.summary().normalMs());
	}

	@Test
	void onlyRecentIntervalsAreRememberedForRetries() {
		// 메모리가 측정 시간에 따라 늘지 않게 최근 RETRY_WINDOW개만 기억한다. 더 오래된 재전송은 역순으로 409.
		int count = SessionEngine.RETRY_WINDOW + 10;
		for (int index = 0; index < count; index++) {
			engine.accept(observation(index, index * 500L, (index + 1) * 500L, 0.1, true, Observation.Phase.running));
		}
		var view = engine.view();
		var recent = observation(count - SessionEngine.RETRY_WINDOW, (count - SessionEngine.RETRY_WINDOW) * 500L,
			(count - SessionEngine.RETRY_WINDOW + 1) * 500L, 0.1, true, Observation.Phase.running);
		assertEquals(view, engine.accept(recent));
		var forgotten = observation(9, 4500, 5000, 0.1, true, Observation.Phase.running);
		assertEquals(409, assertThrows(ApiError.class, () -> engine.accept(forgotten)).status());
		assertEquals(view, engine.view());
	}

	@Test
	void unmeasurableTimeCountsJudgementImpossibleAndAwayUntilAValidOrRestInterval() {
		feed(0, 1000, 0.1);
		assertEquals(0, engine.unmeasurableMs());
		phase(1000, 3000, 0, false, Observation.Phase.running); // 판정 불가 2초
		phase(3000, 4000, 0, false, Observation.Phase.away); // 자리 비움 1초
		assertEquals(3000, engine.unmeasurableMs());
		engine.accept(observation(sequence++, 6000, 7000, 0, false, Observation.Phase.running)); // 2초 누락은 더하지 않는다
		assertEquals(4000, engine.unmeasurableMs());
		phase(7000, 8000, 0, false, Observation.Phase.rest); // 사용자가 누른 쉬기는 초기화
		assertEquals(0, engine.unmeasurableMs());
		phase(8000, 9000, 0, false, Observation.Phase.running);
		assertEquals(1000, engine.unmeasurableMs());
		feed(9000, 10000, 0.1); // 유효한 측정도 초기화
		assertEquals(0, engine.unmeasurableMs());
	}

	@Test
	void pausedAndInvalidReasonsFollowTheLastInterval() {
		assertNull(engine.pausedReason());
		feed(0, 1000, 0.1);
		assertNull(engine.pausedReason());
		phase(1000, 2000, 0, false, Observation.Phase.running);
		assertEquals("unmeasurable", engine.pausedReason());
		phase(2000, 3000, 0, false, Observation.Phase.rest);
		assertEquals("rest", engine.pausedReason());
		phase(3000, 4000, 0, false, Observation.Phase.away);
		assertEquals("away", engine.pausedReason());

		var valid = observation(0, 0, 500, 0.2, true, Observation.Phase.running);
		var invalid = observation(0, 0, 500, 0, false, Observation.Phase.running);
		var rest = observation(0, 0, 500, 0, false, Observation.Phase.rest);
		assertNull(SessionEngine.invalidReason(valid, "head_turn"));
		assertEquals("head_turn", SessionEngine.invalidReason(invalid, "head_turn"));
		assertEquals("unmeasurable", SessionEngine.invalidReason(invalid, null));
		assertEquals("unmeasurable", SessionEngine.invalidReason(rest, "head_turn"));
	}

	// 단일 API에서 새로 생긴 것: 실시간용 사건별 요약, DB용 제외 구간.

	@Test
	void everyDecisionCarriesTheSummaryAtThatPoint() {
		// 확정 시간이 0.5초면 공백 뒤 입력 하나에서 사건 두 개(공백 중단, 새 붕괴)가 나온다.
		// 각 사건의 요약은 그 사건까지의 상태와 맞아야 한다.
		engine = new SessionEngine(UUID.randomUUID(), new Policy(500, 500, 60000, 0.7));
		feed(0, 1000, 0.9);
		engine.accept(observation(sequence++, 4000, 5000, 0.9, true, Observation.Phase.running));
		var decided = engine.eventsAfter(0);
		assertEquals(List.of("collapse_confirmed", "interrupted", "collapse_confirmed"),
			decided.stream().map(d -> d.event().kind()).toList());
		var interrupted = decided.get(1);
		assertEquals("missing", interrupted.event().reason());
		assertEquals(1, interrupted.summary().collapseCount());
		assertEquals(1000, interrupted.summary().totalMs());
		assertEquals(2, decided.get(2).summary().collapseCount());
		assertEquals(5000, decided.get(2).summary().totalMs());
		assertEquals(List.of(decided.get(2)), engine.eventsAfter(2));
	}

	@Test
	void exclusionSpansMergeAdjacentReasonsAndCoverTheGapToTheEnd() {
		feed(0, 1000, 0.1);
		phase(1000, 3000, 0.1, true, Observation.Phase.rest);
		phase(3000, 4000, 0.1, true, Observation.Phase.away);
		phase(4000, 5000, 0.1, false, Observation.Phase.running);
		feed(7000, 8000, 0.1);
		engine.end(9500);
		assertEquals(
			List.of(
				new ExcludedSpan(1000, 3000, ExcludedSpan.Reason.PAUSE),
				new ExcludedSpan(3000, 4000, ExcludedSpan.Reason.ABSENCE),
				new ExcludedSpan(4000, 5000, ExcludedSpan.Reason.UNMEASURABLE),
				new ExcludedSpan(5000, 7000, ExcludedSpan.Reason.MISSING),
				new ExcludedSpan(8000, 9500, ExcludedSpan.Reason.MISSING)),
			engine.excluded());
		var summary = engine.view().summary();
		long excluded = engine.excluded().stream().mapToLong(s -> s.endMs() - s.startMs()).sum();
		assertEquals(summary.totalMs() - summary.validMs(), excluded);
	}

	@Test
	void sessionEndedEventClosesTheLedgerAtTheTotal() {
		feed(0, 3000, 0.9);
		var view = engine.end(4000);
		var last = view.events().get(view.events().size() - 1);
		assertEquals("session_ended", last.kind());
		assertEquals(4000, last.timestampMs());
		assertEquals(view.summary().totalMs(), last.timestampMs());
		assertTrue(view.ended());
		var kinds = view.events().stream().map(SessionView.DecisionEvent::kind).toList();
		assertEquals(List.of("collapse_confirmed", "interrupted", "session_ended"), kinds);
		assertEquals("missing", view.events().get(1).reason());
	}
}
