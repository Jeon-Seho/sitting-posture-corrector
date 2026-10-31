package org.posegood.api.session;

import org.posegood.api.contract.FrameInference;

import java.util.UUID;

/**
 * 좌표 구간 하나의 프레임을 추론 v3에 넘기는 길(계획 0064). 설정 {@code posegood.inference.transport}로 고른다.
 *
 * <ul>
 *   <li>{@code http}(기본, 개발·시험): {@link InferenceClient}가 {@code POST /v3/infer}를 불러 결과를 바로 돌려준다.</li>
 *   <li>{@code kafka}(서버): {@link KafkaInferenceGateway}가 요청 토픽에 발행하고 null을 돌려준다. 결과는
 *       {@link InferenceResultListener}가 결과 토픽에서 받아 {@link SessionService#inferred}로 판정 엔진에 넣는다.</li>
 * </ul>
 */
public interface InferenceGateway {
    /**
     * 프레임을 추론에 넘긴다. 결과를 바로 알면 확인한 결과를, 나중에 오면 null을 돌려준다. 넘기지 못했거나 결과가
     * 계약과 맞지 않으면 502({@link org.posegood.api.common.ApiError#upstream}).
     */
    FrameInference.Response submit(UUID sessionId, long sequence, FrameInference.Request request);

    /** 기대하는 추론 모델 이름. 결과의 {@code model_version}이 이와 같아야 한다. */
    String modelVersion();
}
