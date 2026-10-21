package com.posture.api.posture.cep;

import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * (D-20) 세션 만료 기준 시각은 DB 함수가 아니라 서버가 계산해 바인딩한다.
 * 저장할 때와 같은 {@code Timestamp.from(Instant)} 경로를 타므로 JDBC 접속 시간대(KST)로
 * 똑같이 변환된다 — 여기서는 기준 시각 계산 자체만 확인한다.
 */
class CepJdbcRepositoryTest {

    @Test
    void expiryCutoffIsNowMinusTimeout() {
        Instant now = Instant.parse("2026-10-08T00:30:00Z");
        Timestamp cutoff = CepJdbcRepository.expiryCutoff(now, 300);
        assertThat(cutoff.toInstant()).isEqualTo(Instant.parse("2026-10-08T00:25:00Z"));
    }

    @Test
    void cutoffUsesSameConversionAsStoredValues() {
        // last_seen_at은 Timestamp.from(lastSeen)으로 저장된다 → 같은 Instant면 같은 Timestamp
        Instant lastSeen = Instant.parse("2026-10-08T00:25:00Z");
        Timestamp stored = Timestamp.from(lastSeen);
        Timestamp cutoff = CepJdbcRepository.expiryCutoff(lastSeen.plusSeconds(300), 300);
        assertThat(cutoff).isEqualTo(stored);
    }
}
