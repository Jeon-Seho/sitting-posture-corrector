package org.posegood.api.common;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/**
 * 한국 시간(KST) 변환 도구. DB의 DATETIME(3)은 모두 KST로 저장한다.
 *
 * JDBC로는 시간대 없는 {@link LocalDateTime}을 주고받아 DB 세션 시간대 설정에 영향받지 않는다(CR-04).
 * API 응답의 시각은 UTC {@link Instant}다.
 */
public final class KstTime {
    public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

    private KstTime() {}

    public static LocalDateTime now() {
        return of(Instant.now());
    }

    public static LocalDateTime of(Instant value) {
        return LocalDateTime.ofInstant(value.truncatedTo(ChronoUnit.MILLIS), ZONE);
    }

    public static Instant instant(LocalDateTime value) {
        return value == null ? null : value.atZone(ZONE).toInstant();
    }

    public static Instant read(ResultSet row, String column) throws SQLException {
        return instant(row.getObject(column, LocalDateTime.class));
    }

    /** `daily_stat.stat_date`: 세션 시작 시각의 KST 날짜(BR-61). */
    public static LocalDate day(Instant value) {
        return LocalDate.ofInstant(value, ZONE);
    }
}
