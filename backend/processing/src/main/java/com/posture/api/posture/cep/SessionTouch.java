package com.posture.api.posture.cep;

import java.time.Instant;

/**
 * (D-18) 한 세션에 대해 아직 DB에 쓰지 않은 샘플들의 요약.
 * 같은 세션의 샘플은 메시지마다 DB에 쓰지 않고 이 객체 하나로 합친다.
 */
record SessionTouch(String sessionId, String userId, Instant firstSeen, Instant lastSeen, int samples) {

    static SessionTouch of(String sessionId, String userId, Instant at) {
        return new SessionTouch(sessionId, userId, at, at, 1);
    }

    /** 다른 요약(또는 샘플 1건)을 합친다. userId는 먼저 알려진 값을 유지한다. */
    SessionTouch merge(SessionTouch other) {
        return new SessionTouch(
                sessionId,
                userId != null ? userId : other.userId,
                firstSeen.isBefore(other.firstSeen) ? firstSeen : other.firstSeen,
                lastSeen.isAfter(other.lastSeen) ? lastSeen : other.lastSeen,
                samples + other.samples);
    }
}
