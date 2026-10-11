package org.posegood.api.common;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/**
 * Schema V2.2 stores every {@code DATETIME(3)} as Korea Standard Time (CR-04). Values cross JDBC as
 * zone-less {@link LocalDateTime}, so the conversion never depends on the DB session time zone.
 * API responses keep UTC {@link Instant}s.
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

    /** `daily_stat.stat_date`: the KST calendar day of a session start (BR-61). */
    public static LocalDate day(Instant value) {
        return LocalDate.ofInstant(value, ZONE);
    }
}
