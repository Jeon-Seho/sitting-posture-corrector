package org.posegood.api.workspace;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import tools.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;

/**
 * 설정 형식 검사 시험. 앱 기록 형식 검사는 기록 저장(R2)과 함께 삭제했다(계획 0061).
 *
 * 손으로 쓴 합성 설정 JSON만 쓴다.
 */
class RecordValidatorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void settingsRangesFollowTheApp() throws Exception {
        assertDoesNotThrow(
                () ->
                        RecordValidator.rules(
                                mapper.readTree(
                                        "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.5}")));
        assertThrows(
                ApiError.class,
                () ->
                        RecordValidator.rules(
                                mapper.readTree(
                                        "{\"holdSeconds\":0,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.5}")));
    }
}
