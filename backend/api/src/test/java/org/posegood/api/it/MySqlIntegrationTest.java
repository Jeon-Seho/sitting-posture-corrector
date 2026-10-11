package org.posegood.api.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.posegood.api.account.AccountService;
import org.posegood.api.session.LiveSessions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * The API on a real MySQL with the unchanged schema V2.2 and seed, plus a loopback inference stub
 * with the reference rule. Every account, feature and record is synthetic. Run with
 * {@code -Pmysql-integration} (backend/README.md).
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"server.address=127.0.0.1", "posegood.withdrawal-purge-initial-ms=3600000"})
@EnabledIfSystemProperty(named = "posegood.mysql.integration", matches = "true")
class MySqlIntegrationTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static DisposableDatabase database;
    private static SyntheticInference inference;

    @LocalServerPort int port;
    @Autowired LiveSessions live;
    @Autowired AccountService accounts;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        database = DisposableDatabase.create();
        inference = new SyntheticInference();
        registry.add("spring.datasource.url", database::url);
        registry.add("spring.datasource.username", database::user);
        registry.add("spring.datasource.password", database::password);
        registry.add("posegood.inference-url", inference::url);
    }

    @AfterAll
    static void cleanup() throws Exception {
        if (inference != null) inference.close();
        if (database != null) database.close();
    }

    private ApiClient client() {
        return new ApiClient("http://127.0.0.1:" + port);
    }

    private static String email() {
        return "test-" + UUID.randomUUID() + "@example.invalid";
    }

    private static ObjectNode policy() {
        return MAPPER.createObjectNode()
                .put("hold_ms", 3000)
                .put("recovery_ms", 3000)
                .put("reminder_ms", 60000)
                .put("threshold", 0.5);
    }

    private static ObjectNode create(UUID baseline) {
        return create(baseline, 0.5);
    }

    /** Synthetic mean coordinates of the nine baseline landmarks (schema V2.1). */
    private static ObjectNode create(UUID baseline, double noseX) {
        var body = MAPPER.createObjectNode();
        body.set("policy", policy());
        var setup = body.putObject("setup");
        setup.putObject("device").put("key", "synthetic-device").put("label", "합성 카메라");
        setup.putObject("frame").put("width", 640).put("height", 480);
        var b = setup.putObject("baseline");
        b.put("baseline_id", baseline.toString()).put("calibration_ms", 3000).put("sample_count", 20);
        var landmarks = b.putObject("landmarks");
        landmarks.putObject("nose").put("x", noseX).put("y", 0.4);
        landmarks.putObject("left_eye").put("x", 0.52).put("y", 0.37);
        landmarks.putObject("right_eye").put("x", 0.48).put("y", 0.37);
        landmarks.putObject("left_ear").put("x", 0.56).put("y", 0.38);
        landmarks.putObject("right_ear").put("x", 0.44).put("y", 0.38);
        landmarks.putObject("mouth_left").put("x", 0.515).put("y", 0.45);
        landmarks.putObject("mouth_right").put("x", 0.485).put("y", 0.45);
        landmarks.putObject("left_shoulder").put("x", 0.65).put("y", 0.62);
        landmarks.putObject("right_shoulder").put("x", 0.35).put("y", 0.623456);
        return body;
    }

    /** A running interval; lateral 0.3 scores 1.0 (deviation), 0 scores 0 (normal). */
    private static ObjectNode feature(UUID baseline, long sequence, long start, long end, double lateral) {
        var body = MAPPER.createObjectNode();
        body.put("schema_version", "2.0")
                .put("feature_version", "shoulder-relative-deltas-v1")
                .put("baseline_id", baseline.toString())
                .put("sequence", sequence)
                .put("start_ms", start)
                .put("end_ms", end)
                .put("phase", "running")
                .put("measurement_quality", "good");
        body.putObject("features")
                .put("head_gap_delta", 0)
                .put("lateral_offset_delta", lateral)
                .put("shoulder_tilt_delta", 0)
                .put("current_quality", 0.9)
                .put("baseline_quality", 0.9);
        return body;
    }

    private static ObjectNode rest(UUID baseline, long sequence, long start, long end) {
        var body = feature(baseline, sequence, start, end, 0);
        body.put("phase", "rest").put("measurement_quality", "poor").putNull("features");
        return body;
    }

    /** Collapse at 3 s, recovery at 6 s, rest to 7 s, then a gap until the end at 9 s. */
    private JsonNode measure(ApiClient api, UUID id, UUID baseline) throws Exception {
        String path = "/v1/sessions/" + id;
        assertEquals(200, api.put(path, create(baseline)).status());
        long sequence = 0;
        for (long at = 0; at < 3000; at += 1000)
            assertEquals(200, api.post(path + "/features", feature(baseline, sequence++, at, at + 1000, 0.3)).status());
        for (long at = 3000; at < 6000; at += 1000)
            assertEquals(200, api.post(path + "/features", feature(baseline, sequence++, at, at + 1000, 0)).status());
        assertEquals(200, api.post(path + "/features", rest(baseline, sequence, 6000, 7000)).status());
        var end = api.post(path + "/end", MAPPER.createObjectNode().put("end_ms", 9000));
        assertEquals(200, end.status());
        return end.body();
    }

    @Test
    void accountSettingsAndLoginRemoval() throws Exception {
        var api = client();
        String email = email();
        assertEquals(200, api.register(email).status());
        assertEquals(email, api.get("/v1/auth/me").body().get("email").asText());

        var workspace = api.get("/v1/workspace").body();
        assertEquals(3, workspace.get("rules").get("holdSeconds").asInt());
        assertEquals(60, workspace.get("rules").get("realertSeconds").asInt());
        assertEquals(0.7, workspace.get("rules").get("threshold").asDouble());
        assertTrue(workspace.get("preferences").get("alerts_on").asBoolean());

        var update = MAPPER.createObjectNode();
        update.putObject("profile").put("name", "바뀐 이름").put("age", 31).put("occupation", "합성");
        update.putObject("rules")
                .put("holdSeconds", 4.5)
                .put("recoverSeconds", 2)
                .put("realertSeconds", 30)
                .put("threshold", 0.6);
        update.putObject("preferences").put("alerts_on", false);
        var updated = api.put("/v1/workspace", update);
        assertEquals(200, updated.status());
        assertEquals(4.5, updated.body().get("rules").get("holdSeconds").asDouble());
        try (var connection = database.connect();
                var query =
                        connection.prepareStatement(
                                "SELECT p.created_by,u.alert_enabled,u.sound_alert_enabled FROM user_account u JOIN"
                                        + " threshold_policy p ON p.threshold_policy_id=u.threshold_policy_id"
                                        + " WHERE u.login_email=?")) {
            query.setString(1, email);
            var row = query.executeQuery();
            assertTrue(row.next());
            assertEquals("USER", row.getString(1));
            assertFalse(row.getBoolean(2)); // 「자세 알림」 (V2.2)
            assertFalse(row.getBoolean(3)); // sound stays at its default
        }
        // The session copies the setting at its start: alerts are recorded as suppressed.
        UUID quiet = UUID.randomUUID(), quietBaseline = UUID.randomUUID();
        assertEquals(200, api.put("/v1/sessions/" + quiet, create(quietBaseline)).status());
        for (long at = 0; at < 3000; at += 1000)
            api.post("/v1/sessions/" + quiet + "/features", feature(quietBaseline, at / 1000, at, at + 1000, 0.3));
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var alert =
                    statement.executeQuery(
                            "SELECT m.alert_enabled,a.delivered,a.suppress_reason FROM monitor_session m JOIN"
                                    + " correction_alert a ON a.monitor_session_id=m.monitor_session_id WHERE"
                                    + " m.client_session_uuid='" + quiet + "'");
            assertTrue(alert.next());
            assertFalse(alert.getBoolean(1));
            assertFalse(alert.getBoolean(2));
            assertEquals("ALERT_OFF", alert.getString(3));
        }

        var stale = client();
        assertEquals(200, stale.login(email, "synthetic-password-1").status());
        var socket = Socket.open(port, stale.cookieHeader());
        socket.send(hello(quiet, 0));
        socket.next("ack");
        var change =
                MAPPER.createObjectNode()
                        .put("current_password", "synthetic-password-1")
                        .put("new_password", "synthetic-password-2");
        assertEquals(204, api.put("/v1/auth/password", change).status());
        // Every SPRING_SESSION row of the account is gone (V2.1 has no auth_epoch).
        try (var connection = database.connect();
                var query =
                        connection.prepareStatement("SELECT COUNT(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?")) {
            query.setString(1, api.userId);
            var row = query.executeQuery();
            assertTrue(row.next());
            assertEquals(0, row.getInt(1));
        }
        assertEquals(401, stale.get("/v1/auth/me").status());
        assertEquals("unauthorized", socket.next("closed").get("reason").asText());
        assertEquals(401, client().login(email, "synthetic-password-1").status());
        assertEquals(200, client().login(email, "synthetic-password-2").status());
    }

    @Test
    void measurementWritesTheV2TablesAndRecordsAreRebuilt() throws Exception {
        var api = client();
        String email = email();
        api.register(email);
        UUID id = UUID.randomUUID(), baseline = UUID.randomUUID();
        var view = measure(api, id, baseline);

        assertTrue(view.get("ended").asBoolean());
        var summary = view.get("summary");
        assertEquals(9000, summary.get("total_ms").asLong());
        assertEquals(6000, summary.get("valid_ms").asLong());
        assertEquals(3000, summary.get("normal_ms").asLong());
        assertEquals(1000, summary.get("rest_ms").asLong());
        assertEquals(2000, summary.get("missing_ms").asLong());
        var kinds = new ArrayList<String>();
        view.get("events").forEach(event -> kinds.add(event.get("kind").asText()));
        assertEquals(List.of("collapse_confirmed", "recovery_confirmed", "session_ended"), kinds);
        assertEquals("left_lean", view.get("events").get(0).get("deviation_type").asText());

        String path = "/v1/sessions/" + id;
        // Retries: the same end and the same input change nothing; others conflict.
        assertEquals(view, api.post(path + "/end", MAPPER.createObjectNode().put("end_ms", 9000)).body());
        assertEquals(409, api.post(path + "/end", MAPPER.createObjectNode().put("end_ms", 9500)).status());
        var retried = api.post(path + "/features", feature(baseline, 0, 0, 1000, 0.3));
        assertEquals(200, retried.status());
        assertEquals(view, retried.body().get("session"));
        assertEquals(409, api.post(path + "/features", feature(baseline, 0, 0, 1000, 0.1)).status());
        assertEquals(409, api.post(path + "/features", feature(baseline, 7, 9000, 9500, 0)).status());

        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var session =
                    statement.executeQuery(
                            "SELECT monitor_session_id,started_at,ended_at,end_reason,good_sec,alert_enabled"
                                    + " FROM monitor_session WHERE client_session_uuid='" + id + "'");
            assertTrue(session.next());
            long key = session.getLong(1);
            // DATETIME values are read as stored (KST), independent of the JVM time zone.
            var started = session.getObject(2, LocalDateTime.class);
            assertEquals(started.plusSeconds(9), session.getObject(3, LocalDateTime.class));
            assertEquals("USER_STOP", session.getString(4));
            assertEquals(new BigDecimal("3.0"), session.getBigDecimal(5));
            assertTrue(session.getBoolean(6));

            var episode =
                    statement.executeQuery(
                            "SELECT event_seq,started_at,confirmed_at,ended_at,end_reason,recovered_at FROM"
                                    + " collapse_event WHERE monitor_session_id=" + key);
            assertTrue(episode.next());
            assertEquals(1, episode.getInt(1));
            assertEquals(started, episode.getObject(2, LocalDateTime.class));
            assertEquals(started.plusSeconds(3), episode.getObject(3, LocalDateTime.class));
            assertEquals(started.plusSeconds(6), episode.getObject(4, LocalDateTime.class));
            assertEquals("RECOVERED", episode.getString(5));
            assertEquals(started.plusSeconds(6), episode.getObject(6, LocalDateTime.class));
            assertFalse(episode.next());

            var alert =
                    statement.executeQuery(
                            "SELECT attempt_seq,delivered,suppress_reason FROM correction_alert WHERE"
                                    + " monitor_session_id=" + key);
            assertTrue(alert.next());
            assertEquals(1, alert.getInt(1));
            assertTrue(alert.getBoolean(2));
            assertFalse(alert.next());

            var excluded =
                    statement.executeQuery(
                            "SELECT exclusion_reason,TIMESTAMPDIFF(MICROSECOND,started_at,ended_at) FROM"
                                    + " excluded_interval WHERE monitor_session_id=" + key + " ORDER BY started_at");
            assertTrue(excluded.next());
            assertEquals("PAUSE", excluded.getString(1));
            assertEquals(1_000_000, excluded.getLong(2));
            assertTrue(excluded.next());
            assertEquals("MISSING", excluded.getString(1));
            assertEquals(2_000_000, excluded.getLong(2));
            assertFalse(excluded.next());

            var daily =
                    statement.executeQuery(
                            "SELECT stat_date,valid_sec,good_sec,session_count,event_count,alerted_event_count"
                                    + " FROM daily_stat d JOIN user_account u ON u.user_account_id=d.user_account_id"
                                    + " WHERE u.login_email='" + email + "'");
            assertTrue(daily.next());
            assertEquals(started.toLocalDate(), daily.getObject(1, LocalDate.class));
            assertEquals(new BigDecimal("6.0"), daily.getBigDecimal(2));
            assertEquals(new BigDecimal("3.0"), daily.getBigDecimal(3));
            assertEquals(1, daily.getInt(4));
            assertEquals(1, daily.getInt(5));
            assertEquals(1, daily.getInt(6));
        }

        // The app record must equal the server decisions; dates come from the DB.
        var record = record(id, baseline, view, true);
        var saved = api.post("/v1/records", record);
        assertEquals(200, saved.status());
        assertNotNull(saved.body().get("startedAt"));
        assertEquals(saved.body(), api.post("/v1/records", record).body());
        var changed = record.deepCopy();
        changed.put("good", 2.5);
        assertEquals(409, api.post("/v1/records", changed).status());
        var forged = record(UUID.randomUUID(), baseline, view, true);
        assertEquals(404, api.post("/v1/records", forged).status());
        var local = record.deepCopy();
        local.remove("server");
        assertEquals(400, api.post("/v1/records", local).status());

        // Records are rebuilt from the session tables (no client_record in V2.1).
        var records = api.get("/v1/records").body();
        assertEquals(1, records.size());
        var rebuilt = records.get(0);
        assertEquals(saved.body().get("startedAt"), rebuilt.get("startedAt"));
        assertEquals(saved.body().get("endedAt"), rebuilt.get("endedAt"));
        assertEquals(record.get("rules"), rebuilt.get("rules"));
        for (var key : List.of("total", "valid", "good"))
            assertEquals(record.get(key).asDouble(), rebuilt.get(key).asDouble(), key);
        assertTrue(rebuilt.get("server").get("confirmed").asBoolean());
        assertEquals(baseline.toString(), rebuilt.get("server").get("baselineId").asText());
        var rebuiltView = rebuilt.get("server").get("view");
        assertEquals(view.get("summary"), rebuiltView.get("summary"));
        assertEquals(view.get("events").size(), rebuiltView.get("events").size());
        for (int index = 0; index < view.get("events").size(); index++) {
            var expected = (ObjectNode) view.get("events").get(index).deepCopy();
            if (!"session_ended".equals(expected.get("kind").asText()))
                expected.put("deviation_type", "unspecified"); // T-36 collapse_type is on hold
            assertEquals(expected, rebuiltView.get("events").get(index));
        }
        assertEquals("referenceChange", rebuilt.get("events").get(0).get("type").asText());
        assertEquals(records, api.get("/v1/workspace").body().get("records"));

        // Deleting the record deletes the session; the daily statistics stay (scenario 2).
        assertEquals(204, api.delete("/v1/records/" + id, null).status());
        assertEquals(404, api.get(path).status());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows =
                    statement.executeQuery(
                            "SELECT (SELECT COUNT(*) FROM monitor_session WHERE client_session_uuid='" + id
                                    + "'),(SELECT COUNT(*) FROM daily_stat d JOIN user_account u ON"
                                    + " u.user_account_id=d.user_account_id WHERE u.login_email='" + email + "')");
            assertTrue(rows.next());
            assertEquals(0, rows.getInt(1));
            assertEquals(1, rows.getInt(2));
        }
    }

    @Test
    void baselinesOwnershipLossAndInferenceFailure() throws Exception {
        var api = client();
        api.register(email());
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        assertEquals(200, api.put("/v1/sessions/" + a, create(first)).status());
        assertEquals(200, api.put("/v1/sessions/" + a, create(first)).status());
        var otherPolicy = create(first);
        ((ObjectNode) otherPolicy.get("policy")).put("hold_ms", 4000);
        assertEquals(409, api.put("/v1/sessions/" + a, otherPolicy).status());
        assertEquals(200, api.put("/v1/sessions/" + b, create(second)).status());
        assertEquals(409, api.put("/v1/sessions/" + UUID.randomUUID(), create(first)).status());
        // The current calibration with other values conflicts (UK-04, BR-63).
        assertEquals(409, api.put("/v1/sessions/" + UUID.randomUUID(), create(second, 0.51)).status());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            // One row per user, overwritten by the new calibration (V2.1); sessions keep their copy.
            var current =
                    statement.executeQuery(
                            "SELECT calibration_uuid,nose_x,right_shoulder_y FROM baseline_posture WHERE"
                                    + " user_account_id=" + api.userId);
            assertTrue(current.next());
            assertEquals(second.toString(), current.getString(1));
            assertEquals(new BigDecimal("0.50000"), current.getBigDecimal(2));
            assertEquals(new BigDecimal("0.62346"), current.getBigDecimal(3));
            assertFalse(current.next());
            var copies =
                    statement.executeQuery(
                            "SELECT client_session_uuid,calibration_uuid FROM monitor_session WHERE"
                                    + " user_account_id=" + api.userId + " ORDER BY monitor_session_id");
            assertTrue(copies.next());
            assertEquals(first.toString(), copies.getString(2));
            assertTrue(copies.next());
            assertEquals(second.toString(), copies.getString(2));
        }
        var missingSetup = MAPPER.createObjectNode();
        missingSetup.set("policy", policy());
        assertEquals(400, api.put("/v1/sessions/" + UUID.randomUUID(), missingSetup).status());

        var other = client();
        other.register(email());
        assertEquals(404, other.get("/v1/sessions/" + b).status());
        assertEquals(404, other.post("/v1/sessions/" + b + "/features", feature(second, 0, 0, 1000, 0.3)).status());

        // A rejected inference changes nothing; the same request succeeds afterwards.
        inference.fail.set(true);
        try {
            assertEquals(502, api.post("/v1/sessions/" + b + "/features", feature(second, 0, 0, 1000, 0.3)).status());
        } finally {
            inference.fail.set(false);
        }
        assertEquals(-1, api.get("/v1/sessions/" + b).body().get("last_sequence").asLong());
        assertEquals(200, api.post("/v1/sessions/" + b + "/features", feature(second, 0, 0, 1000, 0.3)).status());
        assertEquals(409, api.post("/v1/sessions/" + b + "/features", feature(first, 1, 1000, 2000, 0.3)).status());

        // A restart loses the live state: the row stays, the API answers 404 SESSION_LOST.
        var before = api.get("/v1/sessions/" + b).body();
        live.remove(b, "session_lost");
        var lost = api.get("/v1/sessions/" + b);
        assertEquals(404, lost.status());
        assertEquals("SESSION_LOST", lost.body().get("code").asText());
        // An unconfirmed record of the last acknowledged view is still accepted from DB facts and
        // closes the row as ERROR; the rebuilt record has no view (decision state unknown).
        assertEquals(200, api.post("/v1/records", record(b, second, before, false)).status());
        var metadata = api.get("/v1/sessions/" + b + "/metadata").body();
        assertEquals(second.toString(), metadata.get("baseline_id").asText());
        assertFalse(metadata.get("ended_at").isNull());

        // An archived live session is ended where it stands and closed as DISCONNECTED.
        var unfinished = api.get("/v1/sessions/" + a).body();
        assertEquals(200, api.post("/v1/records", record(a, first, unfinished, false)).status());
        assertTrue(api.get("/v1/sessions/" + a).body().get("ended").asBoolean());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var reasons =
                    statement.executeQuery(
                            "SELECT client_session_uuid,end_reason,good_sec FROM monitor_session WHERE"
                                    + " user_account_id=" + api.userId + " ORDER BY monitor_session_id");
            assertTrue(reasons.next());
            assertEquals("DISCONNECTED", reasons.getString(2));
            assertTrue(reasons.next());
            assertEquals("ERROR", reasons.getString(2));
            assertEquals(0, reasons.getBigDecimal(3).signum());
        }
        var records = api.get("/v1/records").body();
        assertEquals(2, records.size());
        for (var rebuilt : records) {
            assertFalse(rebuilt.get("server").get("confirmed").asBoolean());
            if (rebuilt.get("id").asText().equals(b.toString())) {
                assertTrue(rebuilt.get("server").get("view").isNull());
                assertEquals(0, rebuilt.get("total").asDouble());
            } else assertTrue(rebuilt.get("server").get("view").get("ended").asBoolean());
        }
    }

    @Test
    void withdrawalGraceCancelAndPurge() throws Exception {
        var api = client();
        String email = email();
        api.register(email);
        measure(api, UUID.randomUUID(), UUID.randomUUID());
        assertEquals(400, api.delete("/v1/auth/account", MAPPER.createObjectNode().put("password", "wrong-password-1")).status());
        assertEquals(204, api.delete("/v1/auth/account", MAPPER.createObjectNode().put("password", "synthetic-password-1")).status());

        var again = client();
        var closed = again.login(email, "synthetic-password-1");
        assertEquals(403, closed.status());
        assertEquals("ACCOUNT_CLOSED", closed.body().get("code").asText());
        assertEquals(409, client().register(email).status());
        again.refreshCsrf();
        var cancel = MAPPER.createObjectNode().put("email", email).put("password", "synthetic-password-1");
        var cancelled = again.post("/v1/auth/withdrawal/cancel", cancel);
        assertEquals(200, cancelled.status());
        again.userId = cancelled.body().get("user_id").asText();
        again.refreshCsrf();
        assertEquals(200, client().login(email, "synthetic-password-1").status());

        assertEquals(204, again.delete("/v1/auth/account", MAPPER.createObjectNode().put("password", "synthetic-password-1")).status());
        try (var connection = database.connect();
                var update =
                        connection.prepareStatement(
                                "UPDATE deletion_request d JOIN user_account u ON u.user_account_id=d.user_account_id"
                                        + " SET d.account_closed_at=?,d.requested_at=? WHERE u.login_email=?")) {
            var past = LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusDays(31);
            update.setObject(1, past);
            update.setObject(2, past);
            update.setString(3, email);
            assertEquals(1, update.executeUpdate());
        }
        accounts.purgeWithdrawn();
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows = statement.executeQuery("SELECT COUNT(*) FROM user_account WHERE login_email='" + email + "'");
            assertTrue(rows.next());
            assertEquals(0, rows.getInt(1));
        }
        assertEquals(200, client().register(email).status());
    }

    @Test
    void realtimeChannelPushesObservationsDecisionsAndTheEnd() throws Exception {
        var api = client();
        api.register(email());
        UUID id = UUID.randomUUID(), baseline = UUID.randomUUID();
        assertEquals(200, api.put("/v1/sessions/" + id, create(baseline)).status());

        var unauthenticated = Socket.open(port, null);
        unauthenticated.send(hello(id, 0));
        assertEquals("unauthorized", unauthenticated.next("closed").get("reason").asText());

        var socket = Socket.open(port, api.cookieHeader());
        socket.send(hello(id, 0));
        assertEquals(-1, socket.next("ack").get("last_sequence").asLong());
        socket.next("progress");

        var frame = MAPPER.createObjectNode().put("type", "features").put("session_id", id.toString());
        var items = frame.putArray("items");
        for (int index = 0; index < 4; index++)
            items.add(feature(baseline, index, index * 1000L, (index + 1) * 1000L, 0.3));
        socket.send(frame);
        var decision = socket.next("decision");
        assertEquals("collapse_confirmed", decision.get("event").get("kind").asText());
        assertEquals(1, decision.get("summary").get("collapse_count").asLong());
        assertEquals(1, socket.next("alert").get("event_id").asLong());
        assertEquals(3, socket.next("ack").get("last_sequence").asLong());
        assertEquals(4000, socket.next("progress").get("summary").get("total_ms").asLong());

        // A reconnect replays decisions after last_event_id, then ack and progress.
        var resumed = Socket.open(port, api.cookieHeader());
        resumed.send(hello(id, 0));
        assertEquals(1, resumed.next("decision").get("event").get("event_id").asLong());
        assertEquals(3, resumed.next("ack").get("last_sequence").asLong());

        assertEquals(200, api.post("/v1/sessions/" + id + "/end", MAPPER.createObjectNode().put("end_ms", 4000)).status());
        assertEquals("session_ended", socket.next("decision", "session_ended").get("event").get("kind").asText());
        assertEquals("ended", socket.next("closed").get("reason").asText());
    }

    private static ObjectNode hello(UUID id, long lastEventId) {
        return MAPPER.createObjectNode()
                .put("type", "hello")
                .put("schema_version", "1.0")
                .put("session_id", id.toString())
                .put("last_event_id", lastEventId);
    }

    /** The app's RecordItem for the measured view (frontend/src/features/storage/types.ts). */
    private static ObjectNode record(UUID id, UUID baseline, JsonNode view, boolean confirmed) {
        var summary = view.get("summary");
        var record = MAPPER.createObjectNode();
        record.put("id", id.toString())
                .put("startedAt", "2026-10-09T00:00:00Z")
                .put("endedAt", "2026-10-09T00:00:09Z")
                .put("mode", "camera")
                .put("valid", summary.get("valid_ms").asLong() / 1000.0)
                .put("good", summary.get("normal_ms").asLong() / 1000.0)
                .put("total", summary.get("total_ms").asLong() / 1000.0);
        record.putObject("rules")
                .put("holdSeconds", 3)
                .put("recoverSeconds", 3)
                .put("realertSeconds", 60)
                .put("threshold", 0.5);
        var events = record.putArray("events");
        JsonNode collapse = null;
        for (var event : view.get("events")) {
            String kind = event.get("kind").asText();
            if (kind.equals("collapse_confirmed")) collapse = event;
            if (kind.equals("recovery_confirmed") && collapse != null) {
                double confirmedAt = collapse.get("timestamp_ms").asLong() / 1000.0;
                double endAt = event.get("timestamp_ms").asLong() / 1000.0;
                events.addObject()
                        .put("id", collapse.get("event_id").asLong())
                        .put("type", "tilt")
                        .put("startAt", collapse.get("onset_ms").asLong() / 1000.0)
                        .put("validStartAt", collapse.get("onset_valid_ms").asLong() / 1000.0)
                        .put("confirmedAt", confirmedAt)
                        .put("endAt", endAt)
                        .put("durationSec", endAt - collapse.get("onset_ms").asLong() / 1000.0)
                        .put("alerts", 1)
                        .put("firstAlertAt", confirmedAt)
                        .put("recovered", true)
                        .put("recoverySec", endAt - confirmedAt)
                        .put("endedBySession", false)
                        .putNull("endReason")
                        .put("blockId", 0);
                collapse = null;
            }
        }
        if (collapse != null) {
            double confirmedAt = collapse.get("timestamp_ms").asLong() / 1000.0;
            double endAt = summary.get("total_ms").asLong() / 1000.0;
            events.addObject()
                    .put("id", collapse.get("event_id").asLong())
                    .put("type", "tilt")
                    .put("startAt", collapse.get("onset_ms").asLong() / 1000.0)
                    .put("validStartAt", collapse.get("onset_valid_ms").asLong() / 1000.0)
                    .put("confirmedAt", confirmedAt)
                    .put("endAt", endAt)
                    .put("durationSec", endAt - collapse.get("onset_ms").asLong() / 1000.0)
                    .put("alerts", 1)
                    .put("firstAlertAt", confirmedAt)
                    .put("recovered", false)
                    .putNull("recoverySec")
                    .put("endedBySession", false)
                    .put("endReason", "unknown")
                    .put("blockId", 0);
        }
        record.putObject("server")
                .put("baselineId", baseline.toString())
                .put("modelVersion", view.get("last_sequence").asLong() < 0 ? "unmeasured" : "reference-feature-rule-v1")
                .put("confirmed", confirmed)
                .set("view", view);
        return record;
    }

    /** Minimal WebSocket test client; messages are kept in arrival order. */
    private static final class Socket implements WebSocket.Listener {
        private final LinkedBlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        private final StringBuilder partial = new StringBuilder();
        private WebSocket socket;

        static Socket open(int port, String cookie) throws Exception {
            var listener = new Socket();
            var builder = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", "http://127.0.0.1:" + port);
            if (cookie != null) builder.header("Cookie", cookie);
            listener.socket =
                    builder.buildAsync(URI.create("ws://127.0.0.1:" + port + "/v1/realtime"), listener)
                            .get(5, TimeUnit.SECONDS);
            return listener;
        }

        void send(JsonNode message) throws Exception {
            socket.sendText(MAPPER.writeValueAsString(message), true).get(5, TimeUnit.SECONDS);
        }

        /** The next message of {@code type} (and event kind, if given), skipping others. */
        JsonNode next(String type, String... kind) throws Exception {
            long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            while (System.nanoTime() < deadline) {
                var message = messages.poll(100, TimeUnit.MILLISECONDS);
                if (message == null) continue;
                if (!type.equals(message.get("type").asText())) continue;
                if (kind.length > 0 && !kind[0].equals(message.get("event").get("kind").asText())) continue;
                return message;
            }
            throw new AssertionError("no " + type + " message");
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                try {
                    messages.add(MAPPER.readTree(partial.toString()));
                } catch (Exception unreadable) {
                    throw new IllegalStateException(unreadable);
                }
                partial.setLength(0);
            }
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }
    }
}
