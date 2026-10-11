package org.posegood.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.Policy;

import java.math.BigDecimal;

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
}
