package com.posture.api.posture.store;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * (D-51) 기본 판정 정책의 값 4개. DB V2.3의 {@code threshold_policy}에는 이름이 없어 이 값 조합(UK-03)으로 행을 찾는다.
 * 입출구 서버(팀 {@code backend/api})의 {@code posegood.default-policy.*}·시드 {@code seed_04}와 같은 값이어야 한다
 * (기본 0.7·3초·3초·60초). 값은 DB 컬럼 정밀도(DECIMAL(4,3)·DECIMAL(4,1)·INT)에 맞춰 반올림해 둔다.
 */
@Component
public class DefaultPolicy {

	private final BigDecimal threshold;
	private final BigDecimal holdSeconds;
	private final BigDecimal recoverSeconds;
	private final int realertSeconds;

	@Autowired
	public DefaultPolicy(
		@Value("${service-db.default-policy.threshold:0.7}")
		double threshold,
		@Value("${service-db.default-policy.hold-seconds:3}")
		double holdSeconds,
		@Value("${service-db.default-policy.recover-seconds:3}")
		double recoverSeconds,
		@Value("${service-db.default-policy.realert-seconds:60}")
		int realertSeconds) {
		this.threshold = BigDecimal.valueOf(threshold).setScale(3, RoundingMode.HALF_UP);
		this.holdSeconds = BigDecimal.valueOf(holdSeconds).setScale(1, RoundingMode.HALF_UP);
		this.recoverSeconds = BigDecimal.valueOf(recoverSeconds).setScale(1, RoundingMode.HALF_UP);
		this.realertSeconds = realertSeconds;
	}

	/** 시험용: 기본값(0.7·3·3·60). */
	public static DefaultPolicy defaults() {
		return new DefaultPolicy(0.7, 3, 3, 60);
	}

	public BigDecimal threshold() {
		return threshold;
	}

	public BigDecimal holdSeconds() {
		return holdSeconds;
	}

	public BigDecimal recoverSeconds() {
		return recoverSeconds;
	}

	public int realertSeconds() {
		return realertSeconds;
	}

	public Map<String, Object> toMap() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("threshold", threshold);
		values.put("holdSeconds", holdSeconds);
		values.put("recoverSeconds", recoverSeconds);
		values.put("realertSeconds", realertSeconds);
		return values;
	}

	@Override
	public String toString() {
		return "(" + threshold + ", " + holdSeconds + "s, " + recoverSeconds + "s, " + realertSeconds + "s)";
	}
}
