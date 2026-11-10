package org.posegood.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Policy;

/** 정책 값 변환(초·밀리초, 소수 자리) 시험. */
class PolicyValuesTest {
	@Test
	void representablePolicyRoundTrips() {
		var policy = new Policy(3000, 2500, 60000, 0.7);
		var values = ThresholdPolicyRepository.Values.of(policy);
		assertEquals(new BigDecimal("0.700"), values.threshold());
		assertEquals(new BigDecimal("3.0"), values.holdSeconds());
		assertEquals(new BigDecimal("2.5"), values.recoverSeconds());
		assertEquals(60, values.realertSeconds());
		assertEquals(policy, values.policy());
	}

	@Test
	void unrepresentableValuesAreRejectedNotRounded() {
		assertEquals(
			400,
			assertThrows(
				ApiError.class,
				() -> ThresholdPolicyRepository.Values.of(new Policy(3100, 2000, 60000, 0.7)))
				.status());
		assertThrows(
			ApiError.class, () -> ThresholdPolicyRepository.Values.of(new Policy(3000, 2000, 60500, 0.7)));
		assertThrows(
			ApiError.class, () -> ThresholdPolicyRepository.Values.of(new Policy(3000, 2000, 60000, 0.7001)));
		assertThrows(
			ApiError.class, () -> ThresholdPolicyRepository.Values.of(new Policy(1_000_000, 2000, 60000, 0.7)));
	}

	@Test
	void settingsInSecondsUseTheSameRules() {
		assertEquals(
			new Policy(3000, 2000, 30000, 0.5),
			ThresholdPolicyRepository.Values.ofSeconds(3, 2, 30, 0.5).policy());
		assertThrows(ApiError.class, () -> ThresholdPolicyRepository.Values.ofSeconds(3.2, 2, 30, 0.5));
		assertThrows(ApiError.class, () -> ThresholdPolicyRepository.Values.ofSeconds(3, 2, 30.5, 0.5));
		assertThrows(ApiError.class, () -> ThresholdPolicyRepository.Values.ofSeconds(3, 2, 0, 0.5));
	}

	@Test
	void outOfRangeValuesAreRejected() {
		for (var policy : List.of(
			new Policy(0, 2000, 60000, 0.7),
			new Policy(-500, 2000, 60000, 0.7),
			new Policy(3000, 0, 60000, 0.7),
			new Policy(3000, 2000, 0, 0.7),
			new Policy(3000, 2000, 86_401_000, 0.7),
			new Policy(3000, 2000, 60000, 0),
			new Policy(3000, 2000, 60000, -0.5),
			new Policy(3000, 2000, 60000, 1.5))) {
			assertEquals(
				400,
				assertThrows(ApiError.class, () -> ThresholdPolicyRepository.Values.of(policy)).status(),
				policy.toString());
		}
		// 경계값은 받는다: 임계값 1, 가장 짧은 시간, 재알림 24시간.
		var smallest = ThresholdPolicyRepository.Values.of(new Policy(500, 500, 1000, 1));
		assertEquals(new BigDecimal("1.000"), smallest.threshold());
		assertEquals(new BigDecimal("0.5"), smallest.holdSeconds());
		var longest = ThresholdPolicyRepository.Values.of(new Policy(3000, 2000, 86_400_000, 0.7));
		assertEquals(86_400, longest.realertSeconds());
	}

	@Test
	void anInvalidDefaultPolicyStopsStartup() {
		// 생성자 인자 순서: jdbc, threshold, hold, recover, realert(초).
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, 0.7, 0, 3, 60));
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, 0, 3, 3, 60));
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, 1.5, 3, 3, 60));
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, Double.NaN, 3, 3, 60));
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, 0.7, 3, 3, 0.5));
		assertThrows(IllegalStateException.class, () -> new ThresholdPolicyRepository(null, 0.7, 3, 3, 1e12));
		// application.properties 기본값은 통과한다.
		new ThresholdPolicyRepository(null, 0.7, 3, 3, 60);
	}
}
