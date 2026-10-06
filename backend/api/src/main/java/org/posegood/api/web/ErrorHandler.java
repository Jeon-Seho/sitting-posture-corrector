package org.posegood.api.web;

import org.posegood.contracts.ContractError;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Map;

@RestControllerAdvice
public class ErrorHandler {
    @ExceptionHandler(ContractError.class)
    public ResponseEntity<?> conflict(ContractError error) {
        String code = error instanceof ApiError api ? api.code() : "REQUEST_FAILED";
        return ResponseEntity.status(error.status())
                .body(
                        Map.of(
                                "error",
                                error.getMessage(),
                                "code",
                                code,
                                "message",
                                error.getMessage()));
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentNotValidException.class,
        MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<?> invalid(Exception ignored) {
        return ResponseEntity.badRequest()
                .body(
                        Map.of(
                                "error",
                                "invalid contract",
                                "code",
                                "INVALID_CONTRACT",
                                "message",
                                "invalid contract"));
    }

    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    public ResponseEntity<?> storageUnavailable(Exception ignored) {
        return ResponseEntity.status(503)
                .body(
                        Map.of(
                                "error",
                                "storage unavailable",
                                "code",
                                "STORAGE_UNAVAILABLE",
                                "message",
                                "storage unavailable; retry original request"));
    }
}
