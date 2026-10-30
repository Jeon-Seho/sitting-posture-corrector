package org.posegood.api.system;

import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * /health: API가 살아 있고 DB에 접속되는지 확인한다.
 */
@RestController
public class HealthController {
	private final JdbcTemplate jdbc;

	public HealthController(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@GetMapping("/health")
	public Map<String, String> health() {
		jdbc.queryForObject("SELECT 1", Integer.class);
		return Map.of("status", "ok", "storage", "mysql");
	}
}
