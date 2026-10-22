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
 * 구간은 [startMs, endMs)이다(끝은 포함하지 않음).
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
     * {@code /v2/realtime} observation 메시지의 관측 3.0: 관측 2.0에 {@code valid_ms}, {@code invalid_reason}을 더했다.
     *
     * 계약: contracts/realtime/realtime-ws.v2.schema.json. 추론 응답은 계속 2.0이고 API가 3.0으로 바꿔 보낸다.
     * {@code valid}면 사유는 null, 아니면 {@code unmeasurable}·{@code head_turn}·{@code settling} 중 하나다.
     */
    public record V3(
            String schemaVersion,
            long sequence,
            long startMs,
            long endMs,
            Phase phase,
            boolean valid,
            long validMs,
            double collapseProbability,
            DeviationType deviationType,
            String invalidReason,
            String modelVersion) {

        /** 관측 2.0과 판정 불가 사유로 3.0을 만든다. 사유가 없으면 판정 불가 구간은 {@code unmeasurable}이다. */
        public static V3 of(Observation observation, String invalidReason) {
            boolean valid = observation.valid();
            return new V3(
                    "3.0",
                    observation.sequence(),
                    observation.startMs(),
                    observation.endMs(),
                    observation.phase(),
                    valid,
                    valid ? observation.endMs() - observation.startMs() : 0,
                    observation.collapseProbability(),
                    observation.deviationType(),
                    valid ? null : invalidReason == null ? "unmeasurable" : invalidReason,
                    observation.modelVersion());
        }
    }
}
