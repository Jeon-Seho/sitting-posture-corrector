package org.posegood.api.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

/** Schema V1.1 stores UTC `DATETIME(3)`; conversion never depends on the DB session time zone. */
public final class DbTime {
    private DbTime() {}

    public static LocalDateTime now() {
        return of(Instant.now());
    }

    public static LocalDateTime of(Instant value) {
        return LocalDateTime.ofInstant(value.truncatedTo(ChronoUnit.MILLIS), ZoneOffset.UTC);
    }

    public static Instant read(ResultSet row, String column) throws SQLException {
        var value = row.getObject(column, LocalDateTime.class);
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }
}
