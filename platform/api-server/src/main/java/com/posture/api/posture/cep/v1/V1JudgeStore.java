package com.posture.api.posture.cep.v1;

import java.util.Map;
import java.util.Optional;

/**
 * (D-37) v1 판정기 상태의 외부 저장소. 운영 구현은 {@link RedisV1JudgeStore}(키 {@code posture:v1:judge:{session_id}}).
 *
 * <p>값은 {@link V1SessionJudge#snapshot()}과 판정기를 만든 사용자 ID다. 구현체는 예외를 밖으로 던지지 않는다 —
 * 저장소가 죽어도 판정은 메모리 상태로 계속된다.
 */
public interface V1JudgeStore {

    /** 저장된 상태. {@code judge}는 {@link V1SessionJudge#snapshot()} 형식. */
    record Stored(String userId, Map<String, Object> judge) {
    }

    Optional<Stored> load(String sessionId);

    void save(String sessionId, String userId, Map<String, Object> judgeSnapshot);

    void delete(String sessionId);

    /** 저장소를 쓰지 않는 구현 (D-22 동작과 같음 — 상태는 메모리에만). */
    V1JudgeStore NO_OP = new V1JudgeStore() {
        @Override
        public Optional<Stored> load(String sessionId) {
            return Optional.empty();
        }

        @Override
        public void save(String sessionId, String userId, Map<String, Object> judgeSnapshot) {
        }

        @Override
        public void delete(String sessionId) {
        }
    };
}
