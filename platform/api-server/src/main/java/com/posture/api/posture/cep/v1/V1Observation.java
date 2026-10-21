package com.posture.api.posture.cep.v1;

import java.util.Map;

/** (D-22) 관측 v2 중 판정에 쓰는 값. */
public record V1Observation(long sequence, long startMs, long endMs, String phase, boolean valid,
                            double collapseProbability, String deviationType) {

    /** 형식이 맞지 않으면 IllegalArgumentException(호출 쪽에서 DLQ로). */
    public static V1Observation fromBody(Map<String, Object> b) {
        long seq = num(b, "sequence");
        long start = num(b, "start_ms");
        long end = num(b, "end_ms");
        if (seq < 0 || start < 0 || end <= start) {
            throw new IllegalArgumentException("sequence/start_ms/end_ms 범위 오류");
        }
        Object phase = b.get("phase");
        if (!"running".equals(phase) && !"rest".equals(phase) && !"away".equals(phase)) {
            throw new IllegalArgumentException("phase 값 오류: " + phase);
        }
        boolean valid = Boolean.TRUE.equals(b.get("valid"));
        double p = b.get("collapse_probability") instanceof Number n ? n.doubleValue() : 0.0;
        if (!Double.isFinite(p) || p < 0 || p > 1) {
            throw new IllegalArgumentException("collapse_probability 범위 오류");
        }
        Object type = b.get("deviation_type");
        return new V1Observation(seq, start, end, (String) phase, valid, p,
                type instanceof String s ? s : "none");
    }

    long durationMs() {
        return endMs - startMs;
    }

    private static long num(Map<String, Object> b, String key) {
        Object v = b.get(key);
        if (!(v instanceof Integer) && !(v instanceof Long)) {
            throw new IllegalArgumentException(key + " 없음 또는 정수 아님");
        }
        return ((Number) v).longValue();
    }
}
