package com.posture.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 처리 서비스 진입점 — v1 판정(judge)·판정 결과 저장(report)·운영 API.
 *
 * {@code @EnableScheduling}은 v1 판정 세션 만료({@link com.posture.api.posture.judge.JudgeExpiryScheduler})에 필요하다.
 * (D-38) 옛 posture.summary 경로(cep 패키지)는 지웠다.
 */
@SpringBootApplication
@EnableScheduling
public class ApiServerApplication {
	public static void main(String[] args) {
		SpringApplication.run(ApiServerApplication.class, args);
	}
}
