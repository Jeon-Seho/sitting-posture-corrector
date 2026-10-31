package com.posture.api.posture.judge;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * v1 판정기 세션 만료 — 입력이 {@code judge.session-timeout-seconds}(기본 300초) 동안 없는 세션의 진행 중 사건을
 * 끊김(missing)으로 닫고 {@code session_ended}를 발행한 뒤 정리한다(D-22 규칙 그대로).
 *
 * <p>(D-53) 전에는 옛 경로의 {@code cep.SessionExpiryScheduler}가 함께 돌렸다. 옛 경로를 지워도(D-38) v1 판정이
 * 영향을 받지 않도록 판정 패키지 안으로 옮겼다.
 */
@Component
public class JudgeExpiryScheduler {

	private static final Logger log = LoggerFactory.getLogger(JudgeExpiryScheduler.class);

	private final V1JudgeRegistry registry;
	private final long timeoutSeconds;

	public JudgeExpiryScheduler(V1JudgeRegistry registry,
		@Value("${judge.session-timeout-seconds:300}")
		long timeoutSeconds) {
		this.registry = registry;
		this.timeoutSeconds = timeoutSeconds;
	}

	@Scheduled(
		initialDelayString = "#{${judge.session-expiry-interval-seconds:60} * 1000}",
		fixedDelayString = "#{${judge.session-expiry-interval-seconds:60} * 1000}")
	public void scheduledRun() {
		runOnce();
	}

	/** @return 정리한 세션 수(예외가 나면 -1, 다음 주기에 다시 시도) */
	public int runOnce() {
		try {
			return registry.expireStale(timeoutSeconds);
		} catch (Exception exc) {
			log.error("v1 판정 세션 만료 처리 중 예외 (다음 주기에 재시도)", exc);
			return -1;
		}
	}
}
