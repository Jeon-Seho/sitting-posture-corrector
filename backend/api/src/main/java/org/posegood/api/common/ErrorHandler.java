package org.posegood.api.common;

import java.util.Map;

import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 예외를 JSON 오류 응답으로 바꾼다: ApiError는 그대로, 형식 오류 400, DB 오류 503.
 *
 * 오류 본문은 {@code {error, code, message}}이고 입력값·SQL·토큰은 돌려주지 않는다.
 */
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
