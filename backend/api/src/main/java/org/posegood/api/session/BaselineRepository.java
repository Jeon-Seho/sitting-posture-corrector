package org.posegood.api.session;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.posegood.api.contract.SessionRequests;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** V2.3 기준 자세 이력. 등록 시각은 클라이언트가 고정하고 재시도에도 보존한다. */
@Repository
public class BaselineRepository {
    private static final List<String> JOINTS = List.of("nose", "left_eye", "right_eye", "left_ear",
            "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder");
    private static final String COORDINATES = JOINTS.stream().map(j -> j + "_x," + j + "_y")
            .collect(java.util.stream.Collectors.joining(","));
    private final JdbcTemplate jdbc;

    public BaselineRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public static UUID publicId(long owner, long key) {
        return UUID.nameUUIDFromBytes(("posegood:baseline:" + owner + ":" + key).getBytes(StandardCharsets.UTF_8));
    }

    public Stored current(long owner) {
        var rows = jdbc.query("SELECT * FROM baseline_posture WHERE user_account_id=?"
                + " ORDER BY baseline_posture_id DESC LIMIT 1", this::read, owner);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** 이 사용자의 기준 중 공개 ID가 {@code id}인 것(없으면 null). 세션은 만들 때의 기준을 쓴다. */
    public Stored find(long owner, UUID id) {
        var current = current(owner);
        if (current != null && current.id().equals(id)) return current;
        return jdbc.query("SELECT * FROM baseline_posture WHERE user_account_id=? ORDER BY baseline_posture_id DESC",
                this::read, owner).stream().filter(b -> b.id().equals(id)).findFirst().orElse(null);
    }

    /**
     * 서버가 계산한 기준(WebSocket 자세 등록) 저장. 등록 시각은 서버 시각이다.
     *
     * Caller holds the account lock and transaction.
     */
    public Stored registerComputed(long owner, SessionRequests.Landmarks landmarks) {
        return register(owner, Instant.now(), landmarks);
    }

    /** Caller holds the account lock and transaction. Existing rows are never updated. */
    public Stored register(long owner, Instant registeredAt, SessionRequests.Landmarks landmarks) {
        var at = KstTime.of(registeredAt);
        var existing = jdbc.query("SELECT * FROM baseline_posture WHERE user_account_id=? AND registered_at=?",
                this::read, owner, at);
        var values = values(landmarks);
        if (!existing.isEmpty()) {
            if (!values(existing.get(0).landmarks()).equals(values))
                throw ApiError.conflict("baseline registration conflict");
            return existing.get(0);
        }
        var args = new ArrayList<Object>();
        args.add(owner);
        args.add(at);
        args.addAll(values);
        jdbc.update("INSERT INTO baseline_posture(user_account_id,registered_at," + COORDINATES
                + ") VALUES(" + "?,".repeat(19) + "?)", args.toArray());
        return jdbc.queryForObject("SELECT * FROM baseline_posture WHERE user_account_id=? AND registered_at=?",
                this::read, owner, at);
    }

    private static List<BigDecimal> values(SessionRequests.Landmarks landmarks) {
        var values = new ArrayList<BigDecimal>();
        for (var p : landmarks.points()) {
            values.add(BigDecimal.valueOf(p.x()).setScale(5, RoundingMode.HALF_UP));
            values.add(BigDecimal.valueOf(p.y()).setScale(5, RoundingMode.HALF_UP));
        }
        return values;
    }

    private Stored read(ResultSet row, int n) throws SQLException {
        var points = new ArrayList<SessionRequests.Point>();
        for (var joint : JOINTS)
            points.add(new SessionRequests.Point(row.getDouble(joint + "_x"), row.getDouble(joint + "_y")));
        return new Stored(row.getLong("baseline_posture_id"), row.getLong("user_account_id"),
                KstTime.read(row, "registered_at"), new SessionRequests.Landmarks(points.get(0), points.get(1),
                points.get(2), points.get(3), points.get(4), points.get(5), points.get(6), points.get(7), points.get(8)));
    }

    public record Stored(long key, long owner, Instant registeredAt, SessionRequests.Landmarks landmarks) {
        public UUID id() { return publicId(owner, key); }
        public View view() { return new View("2.0", id(), registeredAt, landmarks); }
    }
    public record View(String schemaVersion, UUID baselineId, Instant registeredAt, SessionRequests.Landmarks landmarks) {}
}
