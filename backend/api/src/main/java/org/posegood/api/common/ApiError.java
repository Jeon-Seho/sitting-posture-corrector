package org.posegood.api.common;

/** A refusal with an HTTP status and a stable code; the message never carries user data. */
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

    /** The session row exists but its in-memory decision state did not survive a restart. */
    public static ApiError lost() {
        return new ApiError(404, "SESSION_LOST", "session state was lost; keep the last record");
    }

    public static ApiError conflict(String message) {
        return new ApiError(409, "CONFLICT", message);
    }

    /** New input or a different end after the session ended. */
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
