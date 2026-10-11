package org.posegood.api.contract;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * 세션 API 요청·응답 본문 모음: 생성, 종료, 특징 응답, 기준 자세.
 *
 * 계약: contracts/accounts.v1.md의 세션 부분.
 */
public final class SessionRequests {
    private SessionRequests() {}

    /**
     * 세션 생성 요청: 판정 정책 + 준비 정보(기준 자세).
     *
     * {@code PUT /v1/sessions/{id}}. {@code setup}은 필수이며, 없으면 컨트롤러가 400으로 알린다.
     */
    public record Create(@NotNull @Valid Policy policy, @Valid Setup setup) {}

    /** 세션 종료 요청: 종료 시점(세션 시작부터 ms). */
    public record End(@PositiveOrZero @Max(86400000) long endMs) {}

    /** 특징 응답 v1: 관측 v2와 최신 세션 조회 응답. */
    public record FeatureResponse(String schemaVersion, Observation observation, SessionView session) {}

    /**
     * 세션 준비 정보: 보정 평균값만 받는다(영상·프레임별 값은 없음).
     * {@code device}·{@code frame}은 앱 호환을 위해 받지만 저장하지 않는다(V2.0에서 장치, V2.1에서 해상도 삭제).
     */
    public record Setup(@Valid Device device, @NotNull @Valid Frame frame, @NotNull @Valid Baseline baseline) {}

    public record Device(
            @NotBlank @Size(max = 128) @Pattern(regexp = "[\\x21-\\x7e]+") String key,
            @NotBlank @Size(max = 100) String label) {}

    public record Frame(@Min(1) @Max(16384) int width, @Min(1) @Max(16384) int height) {}

    /**
     * 기준 자세 한 건(baseline_posture 한 행).
     *
     * DB 정밀도: 시간 0.1초, 좌표 소수 다섯째 자리.
     */
    public record Baseline(
            @NotNull UUID baselineId,
            @Min(100) @Max(999900) long calibrationMs,
            @Min(1) @Max(100000) int sampleCount,
            @NotNull @Valid Landmarks landmarks) {}

    /**
     * 보정 동안 9개 관절의 MediaPipe 정규화 좌표 평균. 0~1 밖의 값(화면 밖 추정)은
     * 보정 실패로 처리한다(database/README.md 9장).
     */
    public record Landmarks(
            @NotNull @Valid Point nose,
            @NotNull @Valid Point leftEye,
            @NotNull @Valid Point rightEye,
            @NotNull @Valid Point leftEar,
            @NotNull @Valid Point rightEar,
            @NotNull @Valid Point mouthLeft,
            @NotNull @Valid Point mouthRight,
            @NotNull @Valid Point leftShoulder,
            @NotNull @Valid Point rightShoulder) {
        /** `baseline_posture` 컬럼 순서(nose_x, nose_y, left_eye_x, ...). */
        public List<Point> points() {
            return List.of(
                    nose, leftEye, rightEye, leftEar, rightEar, mouthLeft, mouthRight, leftShoulder, rightShoulder);
        }
    }

    public record Point(@DecimalMin("0") @DecimalMax("1") double x, @DecimalMin("0") @DecimalMax("1") double y) {
        public Point {
            if (!Double.isFinite(x) || !Double.isFinite(y))
                throw new IllegalArgumentException("baseline coordinate must be finite");
        }
    }
}
