package com.posture.api.posture.cep.v1;

import java.util.Map;

/**
 * (D-22) 세션 판정 정책 — 계약 v1 {@code session_started.body.policy}.
 * 시작 메시지가 없으면 환경변수 기본값(cep.persist/recovery/realert-seconds, cep.collapse-threshold)을 쓴다.
 */
public record V1Policy(long holdMs, long recoveryMs, long reminderMs, double threshold) {

    public static V1Policy fromBody(Map<String, Object> policy, V1Policy fallback) {
        if (policy == null) {
            return fallback;
        }
        return new V1Policy(
                longOr(policy.get("hold_ms"), fallback.holdMs),
                longOr(policy.get("recovery_ms"), fallback.recoveryMs),
                longOr(policy.get("reminder_ms"), fallback.reminderMs),
                policy.get("threshold") instanceof Number n && n.doubleValue() > 0 && n.doubleValue() <= 1
                        ? n.doubleValue() : fallback.threshold);
    }

    private static long longOr(Object v, long fallback) {
        return v instanceof Number n && n.longValue() > 0 ? n.longValue() : fallback;
    }
}
