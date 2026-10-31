package org.posegood.api.contract;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * 추론 v3(계획 0064): API가 받은 좌표 구간 하나의 프레임을 세션 기준 자세와 함께 바로 넘기고, 추론은 프레임마다 결과를
 * 돌려준다(평균하지 않음). HTTP({@code POST /v3/infer})나 Kafka({@link InferenceMessages}) 본문이 같다. 결과는 API
 * 판정 엔진이 약 3초 모아 판정한다.
 *
 * 계약: contracts/inference-request.v3.schema.json, contracts/inference-response.v3.schema.json. 좌표는 로그·DB에
 * 남기지 않는다. 시간 규칙(3초 확정·회복·재알림)과 좋음/나쁨 임계값은 API 판정 엔진에 있다.
 */
public final class FrameInference {
    /** 요청 프레임 최대 수(계약 maxItems). */
    public static final int MAX_FRAMES = 240;

    private FrameInference() {}

    /** {@code baseline}: 등록한 기준 자세 관절 9개 {@code [x, y]}(좌표 구간과 같은 순서). */
    public record Request(String schemaVersion, String featureVersion, List<List<Double>> baseline, List<Frame> frames) {
        public static Request of(SessionRequests.Landmarks baseline, List<Frame> frames) {
            var points = baseline.points().stream().map(point -> List.of(point.x(), point.y())).toList();
            return new Request("3.0", "keypoints-9-v1", points, frames);
        }
    }

    /** 받은 프레임 그대로. {@code valid}는 앱이 판정 불가로 표시했을 때만 false로 싣는다. */
    public record Frame(long tMs, List<List<Double>> p, @JsonInclude(JsonInclude.Include.NON_NULL) Boolean valid) {
        public static Frame of(FrameInterval.Frame frame) {
            return new Frame(frame.tMs(), frame.p(), frame.valid());
        }

        /** 판정에 쓸 수 있는 후보: 사람이 있고 앱이 판정 불가로 표시하지 않았다. */
        public boolean tracked() {
            return p != null && valid == null;
        }
    }

    public record Response(String schemaVersion, String modelVersion, List<Result> frames) {}

    /**
     * 프레임 하나의 결과. {@code collapseProbability}는 이탈 확률 {@code p(이탈)}(학습 모델 전에는 규칙 점수, ADR 0045).
     * {@code deviationType}은 학습 모델로 바꿀 때 뺀다(보류). 판정 불가면 {@code invalidReason}이
     * {@code unmeasurable}·{@code head_turn}이다.
     */
    public record Result(
            long tMs,
            boolean valid,
            double collapseProbability,
            Observation.DeviationType deviationType,
            String invalidReason) {}
}
