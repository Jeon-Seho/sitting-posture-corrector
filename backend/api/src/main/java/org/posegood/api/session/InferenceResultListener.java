package org.posegood.api.session;

import org.posegood.api.common.Json;
import org.posegood.api.contract.InferenceMessages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * 추론 결과 토픽 구독({@code posegood.inference.transport=kafka}, 계획 0084): 결과를 {@code session_id}로 찾은 세션의
 * 판정 엔진 자리에 넣는다({@link SessionService#inferred}).
 *
 * 컨슈머 그룹은 서버(인스턴스)마다 따로 두고({@code posegood.kafka.group-id}) 최신 메시지부터 받는다. 이 서버에 없는
 * 세션(끝났거나 다른 서버의 세션)과 형식이 틀린 메시지는 버린다. 값은 로그에 남기지 않는다.
 */
@Component
@ConditionalOnProperty(name = "posegood.inference.transport", havingValue = "kafka")
public class InferenceResultListener {
    private static final Logger log = LoggerFactory.getLogger(InferenceResultListener.class);

    private final SessionService sessions;
    private final Json json;

    public InferenceResultListener(SessionService sessions, Json json) {
        this.sessions = sessions;
        this.json = json;
    }

    @KafkaListener(topics = "${posegood.kafka.result-topic}", groupId = "${posegood.kafka.group-id}")
    public void onResult(String value) {
        var message = read(value);
        if (message == null) return;
        sessions.inferred(message.sessionId(), message.sequence(), message.body());
    }

    /** 결과 메시지 하나. 형식이 틀리면 null. */
    InferenceMessages.Result read(String value) {
        InferenceMessages.Result message;
        try {
            message = json.read(value, InferenceMessages.Result.class);
        } catch (RuntimeException invalid) {
            log.debug("inference result skipped: unreadable");
            return null;
        }
        if (message == null
                || !InferenceMessages.SCHEMA_VERSION.equals(message.schemaVersion())
                || message.sessionId() == null
                || message.sequence() < 0
                || message.body() == null) {
            log.debug("inference result skipped: envelope mismatch");
            return null;
        }
        return message;
    }
}
