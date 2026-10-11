package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;

/**
 * 판정 정책: 붕괴 확정 시간·회복 시간·재알림 간격(ms)과 임계값. 세션을 만들 때 고정된다.
 *
 * 나중에 설정을 바꾸면 다음 세션부터 적용된다(ADR 0012).
 */
public record Policy(
        @Positive @Max(86400000) long holdMs,
        @Positive @Max(86400000) long recoveryMs,
        @Positive @Max(86400000) long reminderMs,
        @DecimalMin(value = "0", inclusive = false) @DecimalMax("1") double threshold) {

    public Policy {
        if (!Double.isFinite(threshold)) throw new IllegalArgumentException("threshold must be finite");
    }
}
