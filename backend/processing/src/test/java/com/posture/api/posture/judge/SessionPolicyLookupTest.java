package com.posture.api.posture.judge;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

/**
 * (D-105, FE 요청 #2) kafka 판정기가 {@code session_started} 없이 관측부터 받으면 서비스 DB의 그 세션 정책으로 판정한다.
 * 못 읽으면 기본 정책으로 이어 가고 횟수를 남긴다.
 */
class SessionPolicyLookupTest {

	static final String SID = JudgeRegistryTest.SID;
	/** 사용자가 설정에서 고른 값 — 확정 1초(기본 3초). */
	static final JudgePolicy USER = new JudgePolicy(1000, 1000, 30000, 0.7);
	static final JudgePolicy DEFAULT = new JudgePolicy(3000, 3000, 60000, 0.7);

	final AtomicLong now = new AtomicLong(1_000_000);
	final JudgeRegistryTest.MemorySink sink = new JudgeRegistryTest.MemorySink();
	final List<String> asked = new ArrayList<>();

	JudgeRegistry registry(SessionPolicyLookup lookup) {
		return new JudgeRegistry(sink, JudgeStore.NO_OP, DEFAULT, lookup, now::get);
	}

	SessionPolicyLookup returning(Optional<JudgePolicy> policy) {
		return id -> {
			asked.add(id);
			return policy;
		};
	}

	/** 0.5초 구간 두 개(나쁜 자세) — 확정 1초면 1.0초에 확정, 3초면 아직 아님. */
	void twoBadIntervals(JudgeRegistry registry) {
		registry.observation(SID, "u1", JudgeRegistryTest.obs(0, 0, 500, 0.9));
		registry.observation(SID, "u1", JudgeRegistryTest.obs(1, 500, 1000, 0.9));
	}

	@Test
	void observationFirstUsesTheSessionPolicyFromTheDb() {
		JudgeRegistry registry = registry(returning(Optional.of(USER)));
		twoBadIntervals(registry);
		assertThat(sink.kinds()).containsExactly("collapse_confirmed", "progress");
		assertThat(asked).containsExactly(SID); // 세션당 한 번만 읽는다
		assertThat(registry.status().get("policiesFromDb")).isEqualTo(1L);
		assertThat(registry.status().get("policyFallbacks")).isEqualTo(0L);
	}

	@Test
	void missingRowFallsBackToTheDefaultPolicyAndCountsIt() {
		JudgeRegistry registry = registry(returning(Optional.empty()));
		twoBadIntervals(registry);
		assertThat(sink.kinds()).doesNotContain("collapse_confirmed");
		assertThat(registry.status().get("policyFallbacks")).isEqualTo(1L);
	}

	@Test
	void dbErrorFallsBackAndJudgingGoesOn() {
		JudgeRegistry registry = registry(id -> {
			throw new IllegalStateException("db down");
		});
		twoBadIntervals(registry);
		assertThat(registry.status().get("policyFallbacks")).isEqualTo(1L);
		assertThat(registry.status().get("activeSessions")).isEqualTo(1);
	}

	@Test
	void sessionStartedFirstNeverAsksTheDb() {
		JudgeRegistry registry = registry(returning(Optional.of(DEFAULT)));
		registry.sessionStarted(SID, "u1", Map.of("policy",
			Map.of("hold_ms", 1000, "recovery_ms", 1000, "reminder_ms", 60000, "threshold", 0.7)));
		twoBadIntervals(registry);
		assertThat(asked).isEmpty();
		assertThat(sink.kinds()).containsExactly("collapse_confirmed", "progress");
	}

	@Test
	void dbSecondsBecomeMilliseconds() {
		JudgePolicy policy = JdbcSessionPolicyLookup.toPolicy(Map.of(
			"threshold", new BigDecimal("0.650"), "hold_seconds", new BigDecimal("5.0"),
			"recover_seconds", new BigDecimal("2.5"), "realert_seconds", 30));
		assertThat(policy).isEqualTo(new JudgePolicy(5000, 2500, 30000, 0.65));
	}
}
