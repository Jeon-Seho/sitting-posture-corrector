package org.posegood.api.contract;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * 추론 결과 한 구간(관측 v2): 측정 가능 여부, 붕괴 확률, 자세 방향.
 *
 * 구간은 [startMs, endMs)이다(끝은 포함하지 않음). 계획 0064부터 판정 엔진은 좌표 구간 하나를 프레임별 조각(같은 순번의
 * 이 형식 여러 개)으로 받는다.
 */
public record Observation(
        @NotNull @Pattern(regexp = "2\\.0") String schemaVersion,
        @PositiveOrZero long sequence,
        @PositiveOrZero @Max(86400000) long startMs,
        @Positive @Max(86400000) long endMs,
        @NotNull Phase phase,
        boolean valid,
        @DecimalMin("0") @DecimalMax("1") double collapseProbability,
        @NotNull DeviationType deviationType,
        @NotNull @Pattern(regexp = "[a-z0-9._-]{1,64}") String modelVersion) {

    public enum Phase {
        running,
        rest,
        away
    }

    public enum DeviationType {
        none,
        forward_slouch,
        left_lean,
        right_lean,
        unspecified
    }

    public Observation {
        if (endMs <= startMs || endMs - startMs > 1500 || !Double.isFinite(collapseProbability))
            throw new IllegalArgumentException("interval must be 1..1500ms and score finite");
    }

    /**
     * {@code /v2/realtime} observation 메시지의 관측 4.0(계획 0064, 2026-10-30): 서버 묶음마다 하나.
     *
     * 계약: contracts/realtime/realtime-ws.v2.schema.json. 측정 화면이 쓰는 것만 남겼다. 처리 위치는 ack·progress의
     * {@code last_sequence}, 멈춘 이유는 progress의 {@code paused_reason}, 시간은 요약에 있다. 값은 묶음의 마지막
     * 판정 가능 프레임이다. {@code posture}는 세션 정책 임계값으로 나눈 그 순간의 good·bad이고(알림 확정은 decision),
     * 판정 가능 프레임이 없으면 null이며 그때 {@code invalidReason}은 {@code unmeasurable}·{@code head_turn}이다.
     */
    public record V4(String schemaVersion, boolean valid, String posture, double collapseProbability, String invalidReason) {
        public static V4 judged(String posture, double collapseProbability) {
            return new V4("4.0", true, posture, collapseProbability, null);
        }

        public static V4 unjudged(String invalidReason) {
            return new V4("4.0", false, null, 0, invalidReason);
        }
    }
}
