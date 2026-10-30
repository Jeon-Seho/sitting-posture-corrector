package org.posegood.api.engine;

import org.posegood.api.contract.Policy;

/**
 * 판정 규칙 3개(붕괴 확정·회복·재알림)를 정책 값과 비교하는 유일한 곳.
 *
 * 예전 CEP의 {@code posture.epl} 규칙을 옮겼다. 한 구간에는 규칙이 최대 하나만 맞는다:
 * 붕괴 확정은 열린 사건이 없을 때, 재알림은 열린 사건이 있을 때, 회복은 이탈 후보가 아닐 때.
 */
final class DecisionRules {
	enum Decision {
		NONE,
		COLLAPSE_CONFIRMED,
		RECOVERY_CONFIRMED,
		REMINDER
	}

	private DecisionRules() {
	}

	/** 지금 구간에서 나오는 판정(없으면 NONE). */
	static Decision evaluate(
		boolean candidate,
		boolean active,
		long holdMs,
		long recoveryMs,
		long sinceAlertMs,
		Policy policy) {
		if (candidate && !active && holdMs >= policy.holdMs()) {
			return Decision.COLLAPSE_CONFIRMED;
		}
		if (!candidate && active && recoveryMs >= policy.recoveryMs()) {
			return Decision.RECOVERY_CONFIRMED;
		}
		if (candidate && active && sinceAlertMs >= policy.reminderMs()) {
			return Decision.REMINDER;
		}
		return Decision.NONE;
	}
}
