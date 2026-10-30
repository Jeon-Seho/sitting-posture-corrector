package org.posegood.api.engine;

/**
 * 판정에서 뺀 구간 하나(excluded_interval 한 행): 휴식·자리 비움·판정 불가·누락.
 *
 * 시각은 세션 시작부터의 경과 ms다. 붙어 있는 같은 사유 구간은 합쳐서 시작 시각(기본키)이 겹치지 않게 한다.
 */
public record ExcludedSpan(long startMs, long endMs, Reason reason) {
	/** `excluded_interval.exclusion_reason` 값(스키마 V2.2). */
	public enum Reason {
		PAUSE,
		ABSENCE,
		UNMEASURABLE,
		MISSING
	}
}
