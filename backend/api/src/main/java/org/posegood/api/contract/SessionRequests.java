package org.posegood.api.contract;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.List;
import java.util.UUID;

/**
 * 세션 API 요청·응답 본문 모음: 생성, 종료, 특징 응답, 기준 자세.
 *
 * 계약: contracts/accounts.v2.md의 세션 부분.
 */
public final class SessionRequests {
    private SessionRequests() {}

    /**
     * 세션 생성 요청: 계정의 현재 판정 정책 + 서버가 등록한 기준 ID.
     *
     * {@code PUT /v2/sessions/{id}}. {@code baseline_id}는 필수다.
     */
    public record Create(@NotNull @Valid Policy policy, @NotNull UUID baselineId) {}

    /** 세션 종료 요청: 종료 시점(세션 시작부터 ms). */
    public record End(@PositiveOrZero @Max(86400000) long endMs) {}

    /** 특징 응답 v1: 관측 v2와 최신 세션 조회 응답. */
    public record FeatureResponse(String schemaVersion, Observation observation, SessionView session) {}

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
