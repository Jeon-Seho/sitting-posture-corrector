package org.posegood.api.common;

import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Map;

/**
 * 예외를 JSON 오류 응답으로 바꾼다: ApiError는 그대로, 형식 오류 400, DB 오류 503.
 *
 * 오류 본문은 {@code {error, code, message}}(자세 등록 거절은 {@code reason}도)이고 입력값·SQL·토큰은 돌려주지 않는다.
 */
@RestControllerAdvice
public class ErrorHandler {
    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Map<String, String>> api(ApiError error) {
        if (error.reason() == null) return body(error.status(), error.code(), error.getMessage());
        return ResponseEntity.status(error.status())
                .body(Map.of("error", error.getMessage(), "code", error.code(), "message", error.getMessage(),
                        "reason", error.reason()));
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentNotValidException.class,
        HandlerMethodValidationException.class,
        MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<Map<String, String>> invalid(Exception ignored) {
        return body(400, "INVALID_CONTRACT", "invalid contract");
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, String>> storage(DataAccessException ignored) {
        return body(503, "STORAGE_UNAVAILABLE", "storage unavailable; retry original request");
    }

    public static ResponseEntity<Map<String, String>> body(int status, String code, String message) {
        return ResponseEntity.status(status)
                .body(Map.of("error", message, "code", code, "message", message));
    }
}
