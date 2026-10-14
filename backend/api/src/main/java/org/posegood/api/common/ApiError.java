package org.posegood.api.common;

/**
 * API 오류 예외. 상태 코드·오류 코드를 담아 {error, code, message} JSON으로 응답된다.
 *
 * 메시지에는 사용자 데이터를 넣지 않는다.
 */
public class ApiError extends RuntimeException {
    private final int status;
    private final String code;

    public ApiError(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ApiError badRequest(String message) {
        return new ApiError(400, "INVALID_CONTRACT", message);
    }

    public static ApiError notFound() {
        return new ApiError(404, "SESSION_NOT_FOUND", "session not found");
    }

    /** 세션 행은 있지만 API 재시작으로 메모리의 판정 상태가 없어졌다(404 SESSION_LOST). */
    public static ApiError lost() {
        return new ApiError(404, "SESSION_LOST", "session state was lost; keep the last record");
    }

    public static ApiError conflict(String message) {
        return new ApiError(409, "CONFLICT", message);
    }

    /** 끝난 세션에 새 입력이나 다른 종료가 왔다(409). */
    public static ApiError ended() {
        return new ApiError(409, "SESSION_ENDED", "session ended");
    }

    public static ApiError limit(String message) {
        return new ApiError(429, "LIMIT_REACHED", message);
    }

    public static ApiError upstream(String message) {
        return new ApiError(502, "INFERENCE_FAILED", message);
    }
}
