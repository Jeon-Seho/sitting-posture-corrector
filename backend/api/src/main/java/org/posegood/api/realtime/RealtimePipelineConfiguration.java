package org.posegood.api.realtime;

import org.posegood.api.session.SessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 측정 뒤쪽 고르기: {@code posegood.realtime.pipeline}(환경 변수 {@code POSEGOOD_REALTIME_PIPELINE}, 기본 {@code local}).
 *
 * 지금은 {@code local}만 있다. 다른 값이면 시작하지 않는다(설정 실수로 조용히 local이 되지 않게).
 */
@Configuration(proxyBeanMethods = false)
class RealtimePipelineConfiguration {
	@Bean
	MeasurementPipeline measurementPipeline(
		@Value("${posegood.realtime.pipeline:local}")
		String pipeline,
		SessionService sessions) {
		if (!"local".equals(pipeline)) {
			throw new IllegalStateException("posegood.realtime.pipeline must be local (got " + pipeline + ")");
		}
		return new LocalPipeline(sessions);
	}
}
