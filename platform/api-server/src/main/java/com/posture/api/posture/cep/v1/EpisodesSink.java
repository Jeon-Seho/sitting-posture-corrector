package com.posture.api.posture.cep.v1;

import java.util.Map;

/** (D-22) {@code posture.episodes.v1} 발행 대상. 운영은 Kafka, 테스트는 메모리. */
public interface EpisodesSink {

    /** kind = decision | progress, body = 계약 본문. 봉투는 구현이 붙인다. */
    void publish(String sessionId, String userId, String kind, Map<String, Object> body);
}
