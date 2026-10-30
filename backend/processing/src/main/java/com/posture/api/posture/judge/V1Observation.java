package com.posture.api.posture.judge;

import java.util.Map;

/** (D-22) 관측 v2 중 판정에 쓰는 값. */
public record V1Observation(long sequence, long startMs, long endMs, String phase, boolean valid,
	double collapseProbability, String deviationType) {

	/** 형식이 맞지 않으면 IllegalArgumentException(호출 쪽에서 DLQ로). */
	public static V1Observation fromBody(Map<String, Object> body) {
		long seq = num(body, "sequence");
		long start = num(body, "start_ms");
		long end = num(body, "end_ms");
		if (seq < 0 || start < 0 || end <= start) {
			throw new IllegalArgumentException("sequence/start_ms/end_ms 범위 오류");
		}
		Object phase = body.get("phase");
		if (!"running".equals(phase) && !"rest".equals(phase) && !"away".equals(phase)) {
			throw new IllegalArgumentException("phase 값 오류: " + phase);
		}
		boolean valid = Boolean.TRUE.equals(body.get("valid"));
		double collapseProbability = body.get("collapse_probability") instanceof Number n ? n.doubleValue() : 0.0;
		if (!Double.isFinite(collapseProbability) || collapseProbability < 0 || collapseProbability > 1) {
			throw new IllegalArgumentException("collapse_probability 범위 오류");
		}
		Object type = body.get("deviation_type");
		return new V1Observation(seq, start, end, (String)phase, valid, collapseProbability,
			type instanceof String s ? s : "none");
	}

	long durationMs() {
		return endMs - startMs;
	}

	private static long num(Map<String, Object> body, String key) {
		Object value = body.get(key);
		if (!(value instanceof Integer) && !(value instanceof Long)) {
			throw new IllegalArgumentException(key + " 없음 또는 정수 아님");
		}
		return ((Number)value).longValue();
	}
}
