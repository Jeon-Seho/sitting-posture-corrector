package com.posture.api.posture.cep;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;
import java.util.Optional;

/**
 * (D-21) 실시간 계약 v1 {@code posture.inference.v1}을 구독해 판정 엔진에 넘긴다.
 *
 * <p>기존 {@code posture.inference}({@link PostureInferenceConsumer})와 같은 엔진·같은 DB 쓰기 버퍼를 쓴다.
 * 두 경로는 FE 연동(T-13)과 기존 시험(T-10·통합 테스트)이 모두 v1로 옮겨질 때까지 함께 둔다.
 * 컨슈머 그룹은 기존과 따로 둔다({@code api-server-cep-v1}) — 한 그룹에 다른 토픽 구독이 섞여 서로의 재배정에 휘말리지 않게.
 * 처리할 수 없는 메시지는 로그만 남기고 건너뛴다(파티션이 막히지 않게). DLQ는 회의 확인 후.
 */
@Component
public class RealtimeInferenceConsumer {

    private static final Logger log = LoggerFactory.getLogger(RealtimeInferenceConsumer.class);

    private final PostureCepEngine engine;
    private final CepWriteBuffer writeBuffer;
    private final JsonMapper jsonMapper;
    private final RealtimeObservationMapper mapper;

    public RealtimeInferenceConsumer(
            PostureCepEngine engine,
            CepWriteBuffer writeBuffer,
            JsonMapper jsonMapper,
            @Value("${cep.collapse-threshold:0.7}") double collapseThreshold,
            @Value("${cep.realtime.tracked-sessions:10000}") int trackedSessions) {
        this.engine = engine;
        this.writeBuffer = writeBuffer;
        this.jsonMapper = jsonMapper;
        this.mapper = new RealtimeObservationMapper(collapseThreshold, trackedSessions);
    }

    @KafkaListener(
            topics = "${app.kafka.topic.posture-inference-v1:posture.inference.v1}",
            groupId = "${app.kafka.posture-inference-v1-group:api-server-cep-v1}",
            concurrency = "${app.kafka.posture-inference-concurrency:3}")
    public void onMessage(String rawValue) {
        Map<String, Object> msg;
        try {
            msg = jsonMapper.readValue(rawValue, Map.class);
        } catch (Exception exc) {
            log.warn("posture.inference.v1 JSON 파싱 실패, 건너뜀: {}", exc.getMessage());
            return;
        }
        RealtimeObservationMapper.Result result = mapper.map(msg);
        switch (result.kind()) {
            case OBSERVATION -> {
                InferenceEvent event = result.event().orElseThrow();
                writeBuffer.recordSample(event);   // (D-18) DB는 쓰기 버퍼 경유
                Optional<CepOutcome> outcome = engine.handle(event);
                outcome.ifPresent(o -> {
                    log.info("판정 상태 전환(v1): {} (sessionId={})", o.type(), o.sessionId());
                    writeBuffer.recordEvent(o);
                });
            }
            case SESSION_STARTED -> log.info("세션 시작(v1) sessionId={}", result.sessionId());
            case SESSION_ENDED -> log.info("세션 종료(v1) sessionId={} — 최종 처리는 세션 만료 또는 D-23", result.sessionId());
            case IGNORED -> log.warn("posture.inference.v1 메시지 건너뜀 (sessionId={}): {}",
                    result.sessionId(), result.reason());
        }
    }
}
