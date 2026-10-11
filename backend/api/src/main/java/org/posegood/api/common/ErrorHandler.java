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

/** Every error body is {@code {error, code, message}}; no values, SQL, or tokens are echoed. */
@RestControllerAdvice
public class ErrorHandler {
    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Map<String, String>> api(ApiError error) {
        return body(error.status(), error.code(), error.getMessage());
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
