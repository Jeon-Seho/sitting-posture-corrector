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

	private KstTime() {
	}

	public static LocalDateTime now() {
		return of(Instant.now());
	}

	/** 서버 기준 오늘 날짜(KST). 앱의 「오늘」은 이 값을 따른다(FE ADR 0029, BE-6). */
	public static LocalDate today() {
		return LocalDate.now(ZONE);
	}

	/** {@code at} 다음의 KST 자정(그날 00:00이면 하루 뒤). 측정을 자정에 넘길 때 쓴다(BE-6 ①). */
	public static Instant nextMidnight(Instant at) {
		return at.atZone(ZONE).toLocalDate().plusDays(1).atStartOfDay(ZONE).toInstant();
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
}
