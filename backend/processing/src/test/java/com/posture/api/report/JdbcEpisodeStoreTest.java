package com.posture.api.report;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** (D-58) good_sec 계산은 팀 API(SessionRepository.tenths)와 같이 0.1초 아래를 버린다. */
class JdbcEpisodeStoreTest {

    @Test
    void goodSecTruncatesLikeTheTeamApi() {
        assertThat(JdbcEpisodeStore.goodSec(15_250)).isEqualTo(new BigDecimal("15.2"));
        assertThat(JdbcEpisodeStore.goodSec(15_299)).isEqualTo(new BigDecimal("15.2"));
        assertThat(JdbcEpisodeStore.goodSec(15_000)).isEqualTo(new BigDecimal("15.0"));
        assertThat(JdbcEpisodeStore.goodSec(11_000)).isEqualTo(new BigDecimal("11.0"));
        assertThat(JdbcEpisodeStore.goodSec(0)).isEqualTo(new BigDecimal("0.0"));
        assertThat(JdbcEpisodeStore.goodSec(99)).isEqualTo(new BigDecimal("0.0"));
    }
}
