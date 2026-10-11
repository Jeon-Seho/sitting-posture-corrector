package org.posegood.api.engine;

import org.posegood.api.contract.Policy;

/**
 * The only place that compares accumulated time with the frozen policy (formerly
 * {@code cep/src/main/resources/rules/posture.epl}). At most one rule can match one frame: a
 * collapse needs no active episode, a reminder needs one, and a recovery needs a non-candidate.
 */
final class DecisionRules {
    enum Decision {
        NONE,
        COLLAPSE_CONFIRMED,
        RECOVERY_CONFIRMED,
        REMINDER
    }

    private DecisionRules() {}

    static Decision evaluate(
            boolean candidate,
            boolean active,
            long holdMs,
            long recoveryMs,
            long sinceAlertMs,
            Policy policy) {
        if (candidate && !active && holdMs >= policy.holdMs()) return Decision.COLLAPSE_CONFIRMED;
        if (!candidate && active && recoveryMs >= policy.recoveryMs())
            return Decision.RECOVERY_CONFIRMED;
        if (candidate && active && sinceAlertMs >= policy.reminderMs()) return Decision.REMINDER;
        return Decision.NONE;
    }
}
