package com.posture.api.posture.cep.v1;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * (D-37) v1 판정기 상태를 Redis String {@code posture:v1:judge:{session_id}}에 JSON으로 저장한다.
 *
 * <ul>
 *   <li>값: {@code {"user_id": ..., "judge": V1SessionJudge.snapshot()}}. TTL은 기존 상태 저장소와 같은
 *       {@code cep.state-store.ttl-seconds}(기본 1시간) — 정리되지 않은 키도 결국 사라진다.</li>
 *   <li>Redis 오류 시: 예외를 삼키고 {@value #BACKOFF_MILLIS}ms 동안 Redis 호출을 건너뛴다(D-04와 같은 방식).
 *       Redis가 죽어 있는 동안 메시지마다 명령 타임아웃만큼 컨슈머가 멈추지 않게 하기 위함이다. 판정은 메모리로 계속된다.</li>
 *   <li>읽은 값이 깨졌으면(JSON 오류) 없는 것으로 보고 키를 지운다 — 판정은 처음부터 다시 센다.</li>
 * </ul>
 */
@Component
public class RedisV1JudgeStore implements V1JudgeStore {

    private static final Logger log = LoggerFactory.getLogger(RedisV1JudgeStore.class);

    static final String KEY_PREFIX = "posture:v1:judge:";
    static final long BACKOFF_MILLIS = 10_000;

    private final StringRedisTemplate redis;
    private final JsonMapper jsonMapper;
    private final boolean enabled;
    private final Duration ttl;
    private volatile long suspendedUntilMillis;

    public RedisV1JudgeStore(
            StringRedisTemplate redis,
            JsonMapper jsonMapper,
            @Value("${cep.v1-state-store.enabled:true}") boolean enabled,
            @Value("${cep.state-store.ttl-seconds:3600}") long ttlSeconds) {
        this.redis = redis;
        this.jsonMapper = jsonMapper;
        this.enabled = enabled;
        this.ttl = Duration.ofSeconds(ttlSeconds);
        log.info("v1 판정 상태 저장소: Redis {} (키 {}{{session_id}}, TTL {}s)",
                enabled ? "사용" : "미사용", KEY_PREFIX, ttlSeconds);
    }

    @Override
    @SuppressWarnings("unchecked")
    public Optional<Stored> load(String sessionId) {
        if (!available()) {
            return Optional.empty();
        }
        String raw;
        try {
            raw = redis.opsForValue().get(KEY_PREFIX + sessionId);
        } catch (Exception exc) {
            suspend("조회", sessionId, exc);
            return Optional.empty();
        }
        if (raw == null) {
            return Optional.empty();
        }
        try {
            Map<String, Object> m = jsonMapper.readValue(raw, Map.class);
            Object judge = m == null ? null : m.get("judge");
            if (!(judge instanceof Map<?, ?> j)) {
                throw new IllegalArgumentException("judge 없음");
            }
            return Optional.of(new Stored(m.get("user_id") instanceof String u ? u : null, (Map<String, Object>) j));
        } catch (Exception exc) {
            log.warn("v1 판정 상태가 깨져 버림 (sessionId={}): {}", sessionId, exc.getMessage());
            delete(sessionId);
            return Optional.empty();
        }
    }

    @Override
    public void save(String sessionId, String userId, Map<String, Object> judgeSnapshot) {
        if (!available()) {
            return;
        }
        try {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("user_id", userId);
            value.put("judge", judgeSnapshot);
            redis.opsForValue().set(KEY_PREFIX + sessionId, jsonMapper.writeValueAsString(value), ttl);
        } catch (Exception exc) {
            suspend("저장", sessionId, exc);
        }
    }

    @Override
    public void delete(String sessionId) {
        if (!available()) {
            return;
        }
        try {
            redis.delete(KEY_PREFIX + sessionId);
        } catch (Exception exc) {
            suspend("삭제", sessionId, exc);
        }
    }

    private boolean available() {
        return enabled && System.currentTimeMillis() >= suspendedUntilMillis;
    }

    private void suspend(String op, String sessionId, Exception exc) {
        suspendedUntilMillis = System.currentTimeMillis() + BACKOFF_MILLIS;
        log.warn("Redis v1 판정 상태 {} 실패 (sessionId={}) — {}초 동안 Redis 없이 메모리 상태로 판정 계속: {}",
                op, sessionId, BACKOFF_MILLIS / 1000, exc.getMessage());
    }
}
