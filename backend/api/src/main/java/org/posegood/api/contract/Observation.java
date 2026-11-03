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
		if (endMs <= startMs || endMs - startMs > 1500 || !Double.isFinite(collapseProbability)) {
			throw new IllegalArgumentException("interval must be 1..1500ms and score finite");
		}
	}

	/**
	 * {@code /v2/realtime} observation 메시지의 관측 4.0(계획 0084, 2026-11-03): 판정한 구간마다 하나.
	 *
	 * 계약: contracts/realtime/realtime-ws.v2.schema.json. 추론 응답은 계속 2.0이고 API가 4.0으로 바꿔 보낸다.
	 * 측정 화면이 쓰는 것만 남겼다. 멈춘 이유는 progress의 {@code paused_reason}, 누적 시간은 요약, 이탈 종류는
	 * decision에 있다. {@code sequence}는 이 결과의 구간 순번(앱이 보낸 번호는 실시간 채널이 맞춘다),
	 * {@code posture}는 세션 정책 임계값으로 나눈 그 구간의 good·bad이고(알림 확정은 decision),
	 * {@code holdMs}는 이 구간까지 이탈 후보가 이어진 시간(정책 {@code hold_ms}에 닿으면 확정)이다.
	 * 판정 불가면 posture·점수는 null, 이어진 시간은 0이며 사유는 {@code unmeasurable}·{@code head_turn}·
	 * {@code settling} 중 하나다.
	 */
	public record V4(
		String schemaVersion,
		long sequence,
		boolean valid,
		String posture,
		Double collapseProbability,
		long holdMs,
		String invalidReason) {

		public static V4 judged(long sequence, String posture, double collapseProbability, long holdMs) {
			return new V4("4.0", sequence, true, posture, collapseProbability, holdMs, null);
		}

		public static V4 unjudged(long sequence, String invalidReason) {
			return new V4("4.0", sequence, false, null, null, 0, invalidReason);
		}

		/** 순번을 {@code offset}만큼 옮긴 같은 관측(자정 넘김 뒤 세션 순번 → 앱이 보낸 번호). */
		public V4 shifted(long offset) {
			return new V4(schemaVersion, sequence + offset, valid, posture, collapseProbability, holdMs, invalidReason);
		}
	}
}
