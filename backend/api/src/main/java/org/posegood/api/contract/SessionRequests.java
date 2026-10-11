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

/** Public session request and response bodies (contracts/accounts.v1.md, session section). */
public final class SessionRequests {
    private SessionRequests() {}

    /**
     * {@code PUT /v1/sessions/{id}}. {@code setup} is required; the controller reports a missing one
     * as 400 so that the binding stays lenient about absent nested objects.
     */
    public record Create(@NotNull @Valid Policy policy, @Valid Setup setup) {}

    public record End(@PositiveOrZero @Max(86400000) long endMs) {}

    /** Feature response v1: observation v2 plus the latest session view. */
    public record FeatureResponse(String schemaVersion, Observation observation, SessionView session) {}

    /**
     * Calibration means only; no image or per-frame value crosses this boundary. {@code device} and
     * {@code frame} are accepted for client compatibility but not stored (V2.0 dropped T-26, V2.1 the
     * session resolution).
     */
    public record Setup(@Valid Device device, @NotNull @Valid Frame frame, @NotNull @Valid Baseline baseline) {}

    public record Device(
            @NotBlank @Size(max = 128) @Pattern(regexp = "[\\x21-\\x7e]+") String key,
            @NotBlank @Size(max = 100) String label) {}

    public record Frame(@Min(1) @Max(16384) int width, @Min(1) @Max(16384) int height) {}

    /** One `baseline_posture` row (schema V2.1): DB precision 0.1 s and 5 coordinate decimals. */
    public record Baseline(
            @NotNull UUID baselineId,
            @Min(100) @Max(999900) long calibrationMs,
            @Min(1) @Max(100000) int sampleCount,
            @NotNull @Valid Landmarks landmarks) {}

    /**
     * Mean MediaPipe normalized coordinates over the calibration samples. A value outside 0..1
     * (estimated off screen) fails the calibration (database/README.md section 9).
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
        /** Column order of `baseline_posture` (nose_x, nose_y, left_eye_x, ...). */
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
