package org.posegood.api.session;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.config.TopicConfig;
import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.posegood.api.contract.FrameInference;
import org.posegood.api.contract.InferenceMessages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * 추론 v3를 Kafka로 넘긴다({@code posegood.inference.transport=kafka}, 계획 0064).
 *
 * 구간마다 요청 토픽({@code posegood.kafka.request-topic})에 키 {@code session_id}로 발행하고 결과를 기다리지 않는다.
 * 결과는 {@link InferenceResultListener}가 받는다. 발행이 바로 실패하면 502로 알려 그 구간을 누락으로 만들고, 나중에
 * 실패하면 결과가 오지 않으므로 판정 엔진이 {@code posegood.inference.result-timeout} 뒤에 누락으로 버린다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "posegood.inference.transport", havingValue = "kafka")
public class KafkaInferenceGateway implements InferenceGateway {
    private static final Logger log = LoggerFactory.getLogger(KafkaInferenceGateway.class);

    private final KafkaTemplate<String, String> kafka;
    private final Json json;
    private final String requestTopic;
    private final String modelVersion;
    private final Clock clock = Clock.systemUTC();

    public KafkaInferenceGateway(
            KafkaTemplate<String, String> kafka,
            Json json,
            @Value("${posegood.kafka.request-topic}") String requestTopic,
            @Value("${posegood.model-version}") String modelVersion) {
        this.kafka = kafka;
        this.json = json;
        this.requestTopic = requestTopic;
        this.modelVersion = modelVersion;
    }

    @Override
    public FrameInference.Response submit(UUID sessionId, long sequence, FrameInference.Request request) {
        var message = InferenceMessages.Request.of(sessionId, sequence, request, clock.instant());
        try {
            kafka.send(requestTopic, sessionId.toString(), json.write(message))
                    .whenComplete((sent, failed) -> {
                        if (failed != null)
                            log.debug("inference request not delivered: {}", failed.getClass().getSimpleName());
                    });
        } catch (RuntimeException failed) {
            throw ApiError.upstream("inference request not published");
        }
        return null;
    }

    @Override
    public String modelVersion() {
        return modelVersion;
    }

    /**
     * 토픽이 없으면 만들고 보존 시간을 맞춘다. 파티션 수는 처리 서비스 토픽과 같은 3이 기본이다. 요청에는 좌표가 있고
     * Kafka는 사용자별로 지울 수 없으므로 짧게 둔다({@code posegood.kafka.retention}, 기본 1시간).
     */
    @Bean
    NewTopic inferenceRequestTopic(
            @Value("${posegood.kafka.request-topic}") String name,
            @Value("${posegood.kafka.partitions}") int partitions,
            @Value("${posegood.kafka.retention}") Duration retention) {
        return topic(name, partitions, retention);
    }

    @Bean
    NewTopic inferenceResultTopic(
            @Value("${posegood.kafka.result-topic}") String name,
            @Value("${posegood.kafka.partitions}") int partitions,
            @Value("${posegood.kafka.retention}") Duration retention) {
        return topic(name, partitions, retention);
    }

    private static NewTopic topic(String name, int partitions, Duration retention) {
        return new NewTopic(name, partitions, (short) 1)
                .configs(Map.of(TopicConfig.RETENTION_MS_CONFIG, Long.toString(retention.toMillis())));
    }
}
