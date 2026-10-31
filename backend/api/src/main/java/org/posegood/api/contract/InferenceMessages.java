package org.posegood.api.contract;

import java.time.Instant;
import java.util.UUID;

/**
 * 추론 v3의 Kafka 메시지(계획 0064, {@code posegood.inference.transport=kafka}): API ⇄ 추론 서버.
 *
 * 계약: contracts/realtime/kafka-inference-request.v1.schema.json, kafka-inference-result.v1.schema.json. 키는
 * {@code session_id}(같은 세션은 같은 파티션, 순서 유지). 본문은 HTTP {@code POST /v3/infer}의 요청·응답과 같다.
 * {@code sequence}는 세션 기준 구간 순번이고 결과를 그 구간 자리에 넣는 데 쓴다. 좌표는 로그·DB에 남기지 않는다.
 */
public final class InferenceMessages {
    public static final String SCHEMA_VERSION = "1.0";

    private InferenceMessages() {}

    /** API → 추론: 구간 하나의 프레임과 세션 기준 자세. */
    public record Request(
            String schemaVersion,
            UUID messageId,
            UUID sessionId,
            long sequence,
            Instant producedAt,
            FrameInference.Request body) {
        public static Request of(UUID sessionId, long sequence, FrameInference.Request body, Instant now) {
            return new Request(SCHEMA_VERSION, UUID.randomUUID(), sessionId, sequence, now, body);
        }
    }

    /** 추론 → API: 그 구간 프레임마다의 결과. */
    public record Result(
            String schemaVersion,
            UUID messageId,
            UUID sessionId,
            long sequence,
            Instant producedAt,
            FrameInference.Response body) {}
}
