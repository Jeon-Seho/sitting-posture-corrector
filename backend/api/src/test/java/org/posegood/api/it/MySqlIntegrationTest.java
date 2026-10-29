package org.posegood.api.it;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.posegood.api.session.LiveSessions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse.BodyHandlers;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * 실제 MySQL과 가짜 추론 서버로 API 전체 흐름을 확인하는 통합 시험.
 *
 * 스키마·시드를 그대로 쓴 실제 MySQL과 참조 규칙의 loopback 추론 스텁을 쓴다. 계정·좌표는 모두 합성이고, 측정은
 * {@code /v2/realtime}으로 한다(특징 입력 S2·기록 저장 R2는 2026-10-28 삭제, 계획 0062).
 * 실행: {@code backend/gradlew -p backend build -Pmysql-integration}(backend/README.md).
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"server.address=127.0.0.1", "posegood.cors.allowed-origins=" + MySqlIntegrationTest.APP_ORIGIN})
@EnabledIfSystemProperty(named = "posegood.mysql.integration", matches = "true")
class MySqlIntegrationTest {
    static final String APP_ORIGIN = "https://app.example.test";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static DisposableDatabase database;
    private static SyntheticInference inference;

    @LocalServerPort int port;
    @Autowired LiveSessions live;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;

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
                .put("threshold", 0.7);
    }

    private static ObjectNode create(UUID baseline) {
        var body = MAPPER.createObjectNode().put("baseline_id", baseline.toString());
        body.set("policy", policy());
        return body;
    }

    private static ObjectNode registration(double noseX) {
        var b = MAPPER.createObjectNode().put("registration_id", UUID.randomUUID().toString()).put("calibration_ms", 3000).put("sample_count", 20);
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
        return b;
    }

    /** B1 본문: 앱이 낸 평균으로 {@code points}(관절 9개 {x, y})를 보낸다(ADR 0021 5절). */
    private static ObjectNode registration(double[][] points) {
        var b = MAPPER.createObjectNode().put("registration_id", UUID.randomUUID().toString()).put("calibration_ms", 3000).put("sample_count", 20);
        var landmarks = b.putObject("landmarks");
        String[] joints = {"nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left", "mouth_right",
                "left_shoulder", "right_shoulder"};
        for (int i = 0; i < joints.length; i++)
            landmarks.putObject(joints[i]).put("x", points[i][0]).put("y", points[i][1]);
        return b;
    }

    private static UUID baseline(ApiClient api) throws Exception {
        var response = api.post("/v2/baselines", registration(0.5));
        assertEquals(200, response.status());
        return UUID.fromString(response.body().get("baseline_id").asString());
    }

    /** 합성 기준 좌표 UPRIGHT로 등록한 기준 자세. 실시간 측정의 {@link #frame} 치우침은 이 기준과 비교한다. */
    private static UUID upright(ApiClient api) throws Exception {
        var response = api.post("/v2/baselines", registration(UPRIGHT));
        assertEquals(200, response.status());
        return UUID.fromString(response.body().get("baseline_id").asString());
    }

    /**
     * 실시간 v2 측정: 3초 치우침(3초에 붕괴) → 3초 바른 자세(6초에 회복) → 7초까지 쉬기 → 9초 end(2초 누락).
     *
     * 특징 입력(S2)은 2026-10-28 삭제했다(계획 0062). 끝난 세션의 조회 응답(S4)을 돌려준다.
     */
    private JsonNode measure(ApiClient api, UUID id, UUID baseline) throws Exception {
        assertEquals(200, api.put("/v2/sessions/" + id, create(baseline)).status());
        var socket = Socket.open(port);
        socket.send(helloV2(api, "measure", id));
        socket.next("ready");
        long sequence = 0;
        for (; sequence < 6; sequence++) socket.send(frames(sequence, "running", 0.09));
        for (; sequence < 12; sequence++) socket.send(frames(sequence, "running", 0.0));
        for (; sequence < 14; sequence++) socket.send(frames(sequence, "rest", null));
        socket.send(endV2(9000));
        socket.next("decision", "session_ended");
        assertEquals("ended", socket.next("closed").get("reason").asString());
        var view = api.get("/v2/sessions/" + id);
        assertEquals(200, view.status());
        return view.body();
    }

    @Test
    void unusedRoutesAreRemoved() {
        // 계획 0062(2026-10-28): 앱 기능이 없는 S2·S5·S6·R2를 지웠다. 기록 삭제(R3)와 세션 종료(S3)는 남는다.
        var routes = new ArrayList<String>();
        mappings.getHandlerMethods().keySet().forEach(info -> info.getPatternValues().forEach(pattern ->
                info.getMethodsCondition().getMethods().forEach(method -> routes.add(method + " " + pattern))));
        for (var removed : List.of(
                "POST /v2/sessions/{id}/features", "GET /v2/sessions/{id}/metadata", "DELETE /v2/sessions/{id}",
                "POST /v2/records"))
            assertFalse(routes.contains(removed), removed);
        for (var kept : List.of(
                "PUT /v2/sessions/{id}", "POST /v2/sessions/{id}/end", "GET /v2/sessions/{id}", "GET /v2/records",
                "DELETE /v2/records/{id}"))
            assertTrue(routes.contains(kept), kept);
    }

    @Test
    void accountSettingsAndLoginRemoval() throws Exception {
        var api = client();
        String email = email();
        assertEquals(200, api.register(email).status());
        var me = api.get("/v2/auth/me").body();
        assertEquals(email, me.get("email").asString());
        assertTrue(me.get("today").asString().matches("\\d{4}-\\d{2}-\\d{2}"));

        var workspace = api.get("/v2/workspace").body();
        assertEquals(3, workspace.get("rules").get("holdSeconds").asInt());
        assertEquals(60, workspace.get("rules").get("realertSeconds").asInt());
        assertEquals(0.7, workspace.get("rules").get("threshold").asDouble());
        assertTrue(workspace.get("preferences").get("alerts_on").asBoolean()); // 새 계정은 알림 켜짐(V2.6 기본값)

        var update = MAPPER.createObjectNode();
        update.putObject("profile").put("name", "바뀐 이름").put("age", 31).put("occupation", "합성");
        update.putObject("rules")
                .put("holdSeconds", 4.5)
                .put("recoverSeconds", 2)
                .put("realertSeconds", 30)
                .put("threshold", 0.6);
        update.putObject("preferences").put("alerts_on", false);
        var updated = api.put("/v2/workspace", update);
        assertEquals(200, updated.status());
        assertEquals(4.5, updated.body().get("rules").get("holdSeconds").asDouble());
        try (var connection = database.connect();
                var query =
                        connection.prepareStatement(
                                "SELECT u.sound_alert_enabled FROM user_account u JOIN"
                                        + " threshold_policy p ON p.threshold_policy_id=u.threshold_policy_id"
                                        + " WHERE u.login_email=?")) {
            query.setString(1, email);
            var row = query.executeQuery();
            assertTrue(row.next());
            assertFalse(row.getBoolean(1));
        }
        // 세션은 계정에 저장한 정책과 알림 설정을 복사한다. 측정은 다른 탭(stale)의 실시간 연결로 한다.
        ((ObjectNode) update.get("rules")).put("holdSeconds", 3).put("recoverSeconds", 3).put("realertSeconds", 60).put("threshold", 0.7);
        assertEquals(200, api.put("/v2/workspace", update).status());
        UUID quiet = UUID.randomUUID(), quietBaseline = upright(api);
        assertEquals(200, api.put("/v2/sessions/" + quiet, create(quietBaseline)).status());
        var stale = client();
        assertEquals(200, stale.login(email, "synthetic-password-1").status());
        var socket = Socket.open(port);
        socket.send(helloV2(stale, "measure", quiet));
        socket.next("ready");
        for (long sequence = 0; sequence < 7; sequence++) socket.send(frames(sequence, "running", 0.09));
        socket.next("decision", "collapse_confirmed");
        JsonNode ack;
        do ack = socket.next("ack");
        while (ack.get("last_sequence").asLong() != 6);
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var alert =
                    statement.executeQuery(
                            "SELECT m.alert_enabled,a.attempted_at FROM monitor_session m JOIN"
                                    + " correction_alert a ON a.monitor_session_id=m.monitor_session_id WHERE"
                                    + " m.client_session_uuid='" + quiet + "'");
            assertTrue(alert.next());
            assertFalse(alert.getBoolean(1));
            assertNotNull(alert.getObject(2)); // OFF여도 판정 엔진의 알림 시도 이력은 남는다.
        }

        var change =
                MAPPER.createObjectNode()
                        .put("current_password", "synthetic-password-1")
                        .put("new_password", "synthetic-password-2");
        assertEquals(204, api.put("/v2/auth/password", change).status());
        // 그 계정의 refresh 토큰이 모두 철회됐다(V2.6, ADR 0031).
        try (var connection = database.connect();
                var query =
                        connection.prepareStatement(
                                "SELECT COUNT(*),SUM(revoked_at IS NULL) FROM refresh_token WHERE user_account_id=?")) {
            query.setString(1, api.userId);
            var row = query.executeQuery();
            assertTrue(row.next());
            assertTrue(row.getInt(1) >= 2);
            assertEquals(0, row.getInt(2));
        }
        // access 토큰은 철회하지 않는다: 남은 시간(최대 30분)은 통하고, 로그인 유지(refresh)는 바로 막힌다.
        assertEquals(200, stale.get("/v2/auth/me").status());
        assertEquals(401, stale.refresh().status());
        assertEquals("unauthorized", socket.next("closed").get("reason").asString());
        assertEquals(401, client().login(email, "synthetic-password-1").status());
        assertEquals(200, client().login(email, "synthetic-password-2").status());
    }

    private HttpRequest preflight(String path, String origin, String headers) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", headers)
                .build();
    }

    @Test
    void anotherOriginPageCallsTheApiOnlyWhenAllowed() throws Exception {
        // fe-deploy S-1: 확인 요청(OPTIONS)은 보호 경로라도 로그인 없이 답하고, 허용한 출처에만 쿠키를 허락한다.
        var http = HttpClient.newHttpClient();
        for (var path : List.of("/v2/auth/login", "/v2/sessions/" + UUID.randomUUID())) {
            var allowed = http.send(preflight(path, APP_ORIGIN, "authorization,content-type"), BodyHandlers.discarding());
            assertEquals(200, allowed.statusCode());
            assertEquals(APP_ORIGIN, allowed.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
            assertEquals("true", allowed.headers().firstValue("Access-Control-Allow-Credentials").orElse(null));
        }
        var evil = http.send(preflight("/v2/auth/login", "https://evil.example", "content-type"), BodyHandlers.discarding());
        assertEquals(403, evil.statusCode());
        assertTrue(evil.headers().firstValue("Access-Control-Allow-Origin").isEmpty());

        // 실제 요청도 허용 출처에만 허락 헤더가 붙고, 인증 규칙은 그대로다.
        var me = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v2/auth/me")).header("Origin", APP_ORIGIN).build();
        var anonymous = http.send(me, BodyHandlers.discarding());
        assertEquals(401, anonymous.statusCode());
        assertEquals(APP_ORIGIN, anonymous.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
        var forged = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/health")).header("Origin", "https://evil.example").build();
        assertEquals(403, http.send(forged, BodyHandlers.discarding()).statusCode());
        assertEquals(200, client().get("/health").status());
    }

    @Test
    void refreshKeepsTheLoginAndLogoutEndsIt() throws Exception {
        // ADR 0031: access 토큰(Bearer)으로 요청하고, refresh 쿠키로 새 토큰을 받는다. 로그아웃하면 refresh가 막힌다.
        var api = client();
        api.register(email());
        assertEquals(401, client().get("/v2/auth/me").status());
        assertEquals(200, api.get("/v2/auth/me").status());
        var refreshed = api.refresh();
        assertEquals(200, refreshed.status());
        assertEquals(api.userId, refreshed.body().get("user_id").asString());
        assertEquals("Bearer", refreshed.body().get("token_type").asString());
        assertEquals(1800, refreshed.body().get("expires_in").asLong());
        assertEquals(200, api.get("/v2/auth/me").status());
        assertEquals(204, api.post("/v2/auth/logout", null).status());
        assertEquals(401, api.refresh().status());
    }

    @Test
    void measurementWritesTheV2TablesAndRecordsAreRebuilt() throws Exception {
        var api = client();
        String email = email();
        api.register(email);
        UUID id = UUID.randomUUID(), baseline = upright(api);
        var view = measure(api, id, baseline);

        assertTrue(view.get("ended").asBoolean());
        var summary = view.get("summary");
        assertEquals(9000, summary.get("total_ms").asLong());
        assertEquals(6000, summary.get("valid_ms").asLong());
        assertEquals(3000, summary.get("normal_ms").asLong());
        assertEquals(1000, summary.get("rest_ms").asLong());
        assertEquals(2000, summary.get("missing_ms").asLong());
        var kinds = new ArrayList<String>();
        view.get("events").forEach(event -> kinds.add(event.get("kind").asString()));
        assertEquals(List.of("collapse_confirmed", "recovery_confirmed", "session_ended"), kinds);
        assertEquals("left_lean", view.get("events").get(0).get("deviation_type").asString());

        String path = "/v2/sessions/" + id;
        // 재시도: 같은 종료는 아무것도 바꾸지 않고, 다른 종료는 409.
        assertEquals(view, api.post(path + "/end", MAPPER.createObjectNode().put("end_ms", 9000)).body());
        assertEquals(409, api.post(path + "/end", MAPPER.createObjectNode().put("end_ms", 9500)).status());

        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var session =
                    statement.executeQuery(
                            "SELECT monitor_session_id,started_at,ended_at,good_sec,alert_enabled"
                                    + " FROM monitor_session WHERE client_session_uuid='" + id + "'");
            assertTrue(session.next());
            long key = session.getLong(1);
            // DATETIME은 JVM 시간대와 관계없이 저장된 값(KST) 그대로 읽는다.
            var started = session.getObject(2, LocalDateTime.class);
            assertEquals(started.plusSeconds(9), session.getObject(3, LocalDateTime.class));
            assertEquals(new BigDecimal("3.0"), session.getBigDecimal(4));
            assertTrue(session.getBoolean(5)); // 새 계정은 알림 켜짐(V2.6 기본값)을 세션이 복사한다

            var episode =
                    statement.executeQuery(
                            "SELECT event_seq,started_at,confirmed_at,ended_at,recovered_at FROM"
                                    + " collapse_event WHERE monitor_session_id=" + key);
            assertTrue(episode.next());
            assertEquals(1, episode.getInt(1));
            assertEquals(started, episode.getObject(2, LocalDateTime.class));
            assertEquals(started.plusSeconds(3), episode.getObject(3, LocalDateTime.class));
            assertEquals(started.plusSeconds(6), episode.getObject(4, LocalDateTime.class));
            assertEquals(started.plusSeconds(6), episode.getObject(5, LocalDateTime.class));
            assertFalse(episode.next());

            var alert =
                    statement.executeQuery(
                            "SELECT attempted_at FROM correction_alert WHERE"
                                    + " monitor_session_id=" + key);
            assertTrue(alert.next());
            assertEquals(started.plusSeconds(3), alert.getObject(1, LocalDateTime.class));
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

            // daily_stat은 Spark J2(cron 매일 00:00, 전날 KST)만 쓴다(아키텍처 v5.2). API는 세션을 닫아도 쓰지 않는다.
            var daily =
                    statement.executeQuery(
                            "SELECT COUNT(*) FROM daily_stat d JOIN user_account u ON u.user_account_id=d.user_account_id"
                                    + " WHERE u.login_email='" + email + "'");
            assertTrue(daily.next());
            assertEquals(0, daily.getInt(1));
            // 다음 날 J2가 쓴 행을 흉내 낸다(기록을 지워도 남는지 아래에서 확인).
            assertEquals(
                    1,
                    statement.executeUpdate(
                            "INSERT INTO daily_stat(user_account_id,stat_date,valid_sec,good_sec,session_count,event_count,"
                                    + "alerted_event_count,computed_at) SELECT user_account_id,'" + started.toLocalDate()
                                    + "',6.0,3.0,1,1,0,NOW(3) FROM user_account WHERE login_email='" + email + "'"));
        }

        // 기록은 세션 테이블에서 다시 만든다(V2.1에는 client_record가 없다). 측정을 끝낸 서버가 이미 저장했으므로
        // 앱은 기록을 보내지 않는다(기록 저장 R2는 2026-10-28 삭제, 계획 0062).
        var list = api.get("/v2/records").body();
        assertTrue(list.get("today").asString().matches("\\d{4}-\\d{2}-\\d{2}"));
        var records = list.get("records");
        assertEquals(1, records.size());
        var rebuilt = records.get(0);
        assertEquals(id.toString(), rebuilt.get("id").asString());
        var startedAt = java.time.Instant.parse(rebuilt.get("startedAt").asString());
        assertEquals(startedAt.plusSeconds(9), java.time.Instant.parse(rebuilt.get("endedAt").asString()));
        var rules = MAPPER.createObjectNode()
                .put("holdSeconds", 3)
                .put("recoverSeconds", 3)
                .put("realertSeconds", 60)
                .put("threshold", 0.7);
        assertEquals(rules, rebuilt.get("rules"));
        assertEquals(9, rebuilt.get("total").asDouble());
        assertEquals(6, rebuilt.get("valid").asDouble());
        assertEquals(3, rebuilt.get("good").asDouble());
        assertTrue(rebuilt.get("server").get("confirmed").asBoolean());
        assertEquals(baseline.toString(), rebuilt.get("server").get("baselineId").asString());
        var rebuiltView = rebuilt.get("server").get("view");
        assertEquals(view.get("summary"), rebuiltView.get("summary"));
        assertEquals(view.get("events").size(), rebuiltView.get("events").size());
        for (int index = 0; index < view.get("events").size(); index++) {
            var expected = (ObjectNode) view.get("events").get(index).deepCopy();
            if (!"session_ended".equals(expected.get("kind").asString()))
                expected.put("deviation_type", "unspecified"); // T-36 collapse_type 보류
            assertEquals(expected, rebuiltView.get("events").get(index));
        }
        assertEquals("referenceChange", rebuilt.get("events").get(0).get("type").asString());
        assertEquals(records, api.get("/v2/workspace").body().get("records"));

        // 기록을 지우면 세션이 지워지고 일별 통계는 남는다(시나리오 2).
        assertEquals(204, api.delete("/v2/records/" + id, null).status());
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
        UUID first = baseline(api);
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        assertEquals(200, api.put("/v2/sessions/" + a, create(first)).status());
        assertEquals(200, api.put("/v2/sessions/" + a, create(first)).status());
        var otherPolicy = create(first);
        ((ObjectNode) otherPolicy.get("policy")).put("hold_ms", 4000);
        assertEquals(409, api.put("/v2/sessions/" + a, otherPolicy).status());
        UUID second = baseline(api);
        assertEquals(200, api.put("/v2/sessions/" + b, create(second)).status());
        assertEquals(409, api.put("/v2/sessions/" + UUID.randomUUID(), create(first)).status());
        // 과거 기준은 불변이며 세션 FK가 각각 원래 기준을 가리킨다.
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows = statement.executeQuery("SELECT b.baseline_posture_id,b.nose_x,b.right_shoulder_y "
                    + "FROM baseline_posture b WHERE user_account_id=" + api.userId + " ORDER BY baseline_posture_id");
            for (var expected : List.of(first, second)) {
                assertTrue(rows.next());
                assertEquals(expected, org.posegood.api.session.BaselineRepository.publicId(Long.parseLong(api.userId), rows.getLong(1)));
                assertEquals(new BigDecimal("0.50000"), rows.getBigDecimal(2));
                assertEquals(new BigDecimal("0.62346"), rows.getBigDecimal(3));
            }
            assertFalse(rows.next());
        }
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows = statement.executeQuery("SELECT baseline_posture_id FROM monitor_session WHERE client_session_uuid='" + a + "'");
            assertTrue(rows.next());
            assertEquals(first, org.posegood.api.session.BaselineRepository.publicId(Long.parseLong(api.userId), rows.getLong(1)));
        }
        assertEquals(second.toString(), api.get("/v2/baselines/current").body().get("baseline_id").asString());
        var missingSetup = MAPPER.createObjectNode();
        missingSetup.set("policy", policy());
        assertEquals(400, api.put("/v2/sessions/" + UUID.randomUUID(), missingSetup).status());

        var other = client();
        other.register(email());
        assertEquals(404, other.get("/v2/sessions/" + b).status());
        var stranger = Socket.open(port);
        stranger.send(helloV2(other, "measure", b));
        assertEquals("not_owner", stranger.next("closed").get("reason").asString());

        // 추론이 거절되면 그 구간은 반영하지 않고 stalled만 보낸다. 연결은 남아 다음 구간은 처리된다(11.3).
        var socket = Socket.open(port);
        socket.send(helloV2(api, "measure", b));
        socket.next("ready");
        inference.fail.set(true);
        try {
            socket.send(frames(0, "running", 0.09));
            socket.next("stalled");
        } finally {
            inference.fail.set(false);
        }
        assertEquals(-1, api.get("/v2/sessions/" + b).body().get("last_sequence").asLong());
        socket.send(frames(1, "running", 0.09));
        assertEquals(1, socket.next("ack").get("last_sequence").asLong());

        // 재시작하면 판정 상태가 사라진다: 행은 남고 API는 404 SESSION_LOST로 답한다.
        live.remove(b, "session_lost");
        var lost = api.get("/v2/sessions/" + b);
        assertEquals(404, lost.status());
        assertEquals("SESSION_LOST", lost.body().get("code").asString());

        // 진행 중 세션은 S3로 끝낸다. 판정 상태를 잃은 세션 행은 닫는 경로가 없어 기록 목록에 나오지 않는다
        // (기록 저장 R2가 닫던 것, 2026-10-28 삭제 — 계획 0062 남은 일).
        assertTrue(api.post("/v2/sessions/" + a + "/end", MAPPER.createObjectNode().put("end_ms", 0)).body().get("ended").asBoolean());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows =
                    statement.executeQuery(
                            "SELECT client_session_uuid,ended_at FROM monitor_session WHERE"
                                    + " user_account_id=" + api.userId + " ORDER BY monitor_session_id");
            assertTrue(rows.next());
            assertEquals(a.toString(), rows.getString(1));
            assertNotNull(rows.getObject(2));
            assertTrue(rows.next());
            assertEquals(b.toString(), rows.getString(1));
            assertNull(rows.getObject(2));
        }
        var records = api.get("/v2/records").body().get("records");
        assertEquals(1, records.size());
        assertEquals(a.toString(), records.get(0).get("id").asString());
        assertTrue(records.get(0).get("server").get("view").get("ended").asBoolean());
    }

    @Test
    void consentWithdrawalErasesOnlyOptionalProfileAndReagreementAppends() throws Exception {
        var api = client();
        api.register(email());
        var off = MAPPER.createObjectNode().put("agreed", false).put("document_version", "service-v2");
        var withdrawn = api.put("/v2/consents/optional-profile", off);
        assertEquals(200, withdrawn.status());
        assertTrue(withdrawn.body().get("profile").get("age").isNull());
        assertTrue(withdrawn.body().get("profile").get("occupation").isNull());
        assertFalse(withdrawn.body().get("consents").get("optional_profile").asBoolean());
        assertEquals(200, api.put("/v2/consents/optional-profile", off).status());
        var update = ((ObjectNode) withdrawn.body()).deepCopy();
        update.remove(List.of("schema_version", "records", "consents"));
        ((ObjectNode) update.get("profile")).put("age", 30);
        assertEquals(400, api.put("/v2/workspace", update).status());
        assertEquals(200, api.put("/v2/consents/optional-profile", off.deepCopy().put("agreed", true)).status());
        assertEquals(200, api.put("/v2/workspace", update).status());
        ((ObjectNode) update.get("profile")).put("age", 13);
        assertEquals(400, api.put("/v2/workspace", update).status());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows = statement.executeQuery("SELECT COUNT(*),SUM(withdrawn_at IS NOT NULL) FROM user_consent WHERE user_account_id=" + api.userId);
            assertTrue(rows.next());
            assertEquals(7, rows.getInt(1));
            assertEquals(1, rows.getInt(2));
        }
        var anonymous = client();
        String rejected = email();
        var body = MAPPER.createObjectNode().put("email", rejected).put("password", "synthetic-password-1");
        body.putObject("profile").put("name", "합성").putNull("age").putNull("occupation");
        var consents = body.putArray("consents");
        assertEquals(400, anonymous.post("/v2/auth/register", body).status());
        for (var type : List.of("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD", "AGE_14_OVER"))
            consents.addObject().put("type", type).put("document_version", "service-v2");
        // Reusing the rejected email proves registration did not leave an account row behind.
        assertEquals(200, anonymous.post("/v2/auth/register", body).status());
    }

    @Test
    void baselineRetryIsImmutableAndEndIsIdempotent() throws Exception {
        var api = client(); api.register(email());
        assertEquals(404, api.get("/v2/baselines/current").status());
        assertEquals(409, api.put("/v2/sessions/" + UUID.randomUUID(), create(UUID.randomUUID())).status());
        var registration = registration(0.5);
        var before = java.time.Instant.now().minusSeconds(1);
        var saved = api.post("/v2/baselines", registration);
        assertEquals(200, saved.status());
        // The server stamps registered_at itself (ADR 0028); the app no longer sends a time.
        var registeredAt = java.time.Instant.parse(saved.body().get("registered_at").asString());
        assertTrue(!registeredAt.isBefore(before) && !registeredAt.isAfter(java.time.Instant.now().plusSeconds(1)), registeredAt.toString());
        // A retry with the same registration_id returns the stored row, even seconds later.
        assertEquals(saved.body(), api.post("/v2/baselines", registration).body());
        ((ObjectNode) registration.get("landmarks").get("nose")).put("x", 0.51);
        assertEquals(409, api.post("/v2/baselines", registration).status());
        // A new registration_id is a new capture: a new row becomes the current baseline.
        registration.put("registration_id", UUID.randomUUID().toString());
        var second = api.post("/v2/baselines", registration);
        assertEquals(200, second.status());
        assertNotEquals(saved.body().get("baseline_id").asString(), second.body().get("baseline_id").asString());
        registration.remove("registration_id");
        assertEquals(400, api.post("/v2/baselines", registration).status());
        UUID baseline = UUID.fromString(second.body().get("baseline_id").asString());
        UUID id = UUID.randomUUID();
        String path = "/v2/sessions/" + id;
        assertEquals(200, api.put(path, create(baseline)).status());
        var end = MAPPER.createObjectNode().put("end_ms", 300000);
        assertEquals(200, api.post(path + "/end", end).status());
        assertEquals(200, api.post(path + "/end", end).status());
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var sessions = statement.executeQuery("SELECT COUNT(*),SUM(ended_at IS NOT NULL) FROM monitor_session WHERE user_account_id=" + api.userId);
            assertTrue(sessions.next()); assertEquals(1, sessions.getInt(1)); assertEquals(1, sessions.getInt(2));
            var daily = statement.executeQuery("SELECT COUNT(*) FROM daily_stat WHERE user_account_id=" + api.userId);
            assertTrue(daily.next()); assertEquals(0, daily.getInt(1));
        }
    }

    @Test
    void withdrawalIsFinalAndLeavesDeletionToJ3() throws Exception {
        var api = client();
        String email = email();
        api.register(email);
        measure(api, UUID.randomUUID(), upright(api));
        assertEquals(400, api.delete("/v2/auth/account", MAPPER.createObjectNode().put("password", "wrong-password-1")).status());
        assertEquals(204, api.delete("/v2/auth/account", MAPPER.createObjectNode().put("password", "synthetic-password-1")).status());

        // 탈퇴는 되돌릴 수 없다: 로그인은 403, 같은 이메일 재가입은 최종 삭제 전까지 409, 철회 경로는 없다.
        var closed = client().login(email, "synthetic-password-1");
        assertEquals(403, closed.status());
        assertEquals("ACCOUNT_CLOSED", closed.body().get("code").asString());
        assertEquals(409, client().register(email).status());
        var anonymous = client();
        var cancel = MAPPER.createObjectNode().put("email", email).put("password", "synthetic-password-1");
        assertEquals(401, anonymous.post("/v2/auth/withdrawal/cancel", cancel).status());

        // API는 접수만 한다. 유예 30일 뒤 최종 삭제는 Spark J3(cron 매일 04:00) 몫이라 행이 그대로 남는다.
        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var rows =
                    statement.executeQuery(
                            "SELECT u.account_status,d.request_scope,d.request_status,d.account_closed_at IS NOT NULL,"
                                    + "(SELECT COUNT(*) FROM monitor_session m WHERE m.user_account_id=u.user_account_id),"
                                    + "(SELECT COUNT(*) FROM refresh_token r WHERE r.user_account_id=u.user_account_id AND r.revoked_at IS NULL)"
                                    + " FROM user_account u JOIN deletion_request d ON d.user_account_id=u.user_account_id"
                                    + " WHERE u.login_email='" + email + "'");
            assertTrue(rows.next());
            assertEquals("CLOSED", rows.getString(1));
            assertEquals("ACCOUNT_ALL", rows.getString(2));
            assertEquals("REQUESTED", rows.getString(3));
            assertTrue(rows.getBoolean(4));
            assertEquals(1, rows.getInt(5));
            assertEquals(0, rows.getInt(6));
            assertFalse(rows.next());
        }
    }

    /** 합성 기준 좌표(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨), 어깨 폭 약 192px. */
    private static final double[][] UPRIGHT = {
        {0.51234, 0.40211}, {0.53011, 0.3712}, {0.49012, 0.372}, {0.56021, 0.39012}, {0.46011, 0.391},
        {0.52, 0.44}, {0.5, 0.44}, {0.66011, 0.62}, {0.36012, 0.62}
    };

    /** 관절 9개 프레임. {@code shift}만큼 머리(코·눈·귀·입)를 옆으로 옮긴다: 0.09면 좌우 치우침 약 0.3. */
    private static ObjectNode frame(long t, double shift) {
        var frame = MAPPER.createObjectNode().put("t_ms", t);
        var p = frame.putArray("p");
        for (int i = 0; i < 9; i++)
            p.addArray().add(UPRIGHT[i][0] + (i < 7 ? shift : 0)).add(UPRIGHT[i][1]).add(0.95);
        return frame;
    }

    /**
     * v2 features 메시지(구간 1개, 0.5초). {@code shift}가 null이면 사람이 없는 프레임만 있다. 쉬기·자리 비움은 빈 구간이다.
     */
    private static ObjectNode frames(long sequence, String phase, Double shift) {
        var message = MAPPER.createObjectNode().put("type", "features");
        var item = message.putArray("items").addObject();
        long start = sequence * 500;
        item.put("schema_version", "3.0")
                .put("feature_version", "keypoints-9-v1")
                .put("sequence", sequence)
                .put("start_ms", start)
                .put("end_ms", start + 500)
                .put("phase", phase);
        var list = item.putArray("frames");
        if (!phase.equals("running")) return message;
        for (long t = start; t < start + 500; t += 125) {
            if (shift == null) list.addObject().put("t_ms", t).putNull("p");
            else list.add(frame(t, shift));
        }
        return message;
    }

    private static ObjectNode helloV2(ApiClient api, String purpose, UUID id) {
        return MAPPER.createObjectNode()
                .put("type", "hello")
                .put("schema_version", "2.0")
                .put("purpose", purpose)
                .put(purpose.equals("measure") ? "session_id" : "calibration_id", id.toString())
                .put("access_token", api.accessToken());
    }

    private static ObjectNode endV2(long endMs) {
        return MAPPER.createObjectNode().put("type", "end").put("end_ms", endMs);
    }

    @Test
    void realtimeV2MeasuresUntilEnd() throws Exception {
        var api = client();
        api.register(email());

        // 자세 등록은 B1뿐이다(WebSocket 등록은 2026-10-27 삭제). 합성 기준 좌표 UPRIGHT를 앱이 낸 평균으로 보낸다.
        var registration = registration(UPRIGHT);
        var saved = api.post("/v2/baselines", registration);
        assertEquals(200, saved.status());
        UUID baseline = UUID.fromString(saved.body().get("baseline_id").asString());

        // WebSocket 등록을 요청하면 계약 위반으로 닫는다.
        var calibration = Socket.open(port);
        calibration.send(helloV2(api, "measure", UUID.randomUUID()).put("purpose", "calibration"));
        assertEquals("bad_message", calibration.next("closed").get("reason").asString());

        // 측정: 3.5초 치우침(3초에 붕괴 확정) -> 0.5초 사람 없음 -> end 5초.
        UUID id = UUID.randomUUID();
        assertEquals(200, api.put("/v2/sessions/" + id, create(baseline)).status());
        var socket = Socket.open(port);
        socket.send(helloV2(api, "measure", id));
        assertEquals(id.toString(), socket.next("ready").get("session_id").asString());
        for (long sequence = 0; sequence < 7; sequence++) socket.send(frames(sequence, "running", 0.09));
        var observation = socket.next("observation").get("observation");
        assertEquals("3.0", observation.get("schema_version").asString());
        assertTrue(observation.get("valid").asBoolean());
        assertEquals(500, observation.get("valid_ms").asLong());
        assertEquals("left_lean", observation.get("deviation_type").asString());
        var decision = socket.next("decision", "collapse_confirmed");
        assertEquals(3000, decision.get("event").get("timestamp_ms").asLong());
        assertFalse(decision.has("session_id"));
        JsonNode ack;
        do ack = socket.next("ack");
        while (ack.get("last_sequence").asLong() != 6);
        socket.send(frames(7, "running", null));
        JsonNode unmeasurable;
        do unmeasurable = socket.next("observation").get("observation");
        while (unmeasurable.get("sequence").asLong() != 7);
        assertFalse(unmeasurable.get("valid").asBoolean());
        assertEquals("unmeasurable", unmeasurable.get("invalid_reason").asString());
        JsonNode progress;
        do progress = socket.next("progress");
        while (progress.get("last_sequence").asLong() != 7);
        assertEquals("unmeasurable", progress.get("paused_reason").asString());

        socket.send(endV2(5000));
        var ended = socket.next("decision", "session_ended");
        assertEquals(5000, ended.get("summary").get("total_ms").asLong());
        assertEquals(3500, ended.get("summary").get("valid_ms").asLong());
        assertEquals("ended", socket.next("closed").get("reason").asString());

        // 끝난 세션으로 다시 hello하면 session_lost.
        var again = Socket.open(port);
        again.send(helloV2(api, "measure", id));
        assertEquals("session_lost", again.next("closed").get("reason").asString());

        try (var connection = database.connect(); var statement = connection.createStatement()) {
            var row =
                    statement.executeQuery(
                            "SELECT COUNT(*),MAX(b.nose_x),MAX(b.right_shoulder_x) FROM baseline_posture b JOIN"
                                    + " monitor_session m ON m.user_account_id=b.user_account_id WHERE"
                                    + " m.client_session_uuid='" + id + "'");
            assertTrue(row.next());
            assertEquals(1, row.getInt(1));
            assertEquals(0, new BigDecimal("0.51234").compareTo(row.getBigDecimal(2)));
            assertEquals(0, new BigDecimal("0.36012").compareTo(row.getBigDecimal(3)));

            var session =
                    statement.executeQuery(
                            "SELECT monitor_session_id,started_at,ended_at,good_sec FROM monitor_session"
                                    + " WHERE client_session_uuid='" + id + "'");
            assertTrue(session.next());
            long key = session.getLong(1);
            var started = session.getObject(2, LocalDateTime.class);
            assertEquals(started.plusSeconds(5), session.getObject(3, LocalDateTime.class));
            assertEquals(0, session.getBigDecimal(4).signum());

            var episode =
                    statement.executeQuery(
                            "SELECT confirmed_at FROM collapse_event WHERE monitor_session_id=" + key);
            assertTrue(episode.next());
            assertEquals(started.plusSeconds(3), episode.getObject(1, LocalDateTime.class));
            assertFalse(episode.next());

            var excluded =
                    statement.executeQuery(
                            "SELECT exclusion_reason,TIMESTAMPDIFF(MICROSECOND,started_at,ended_at) FROM"
                                    + " excluded_interval WHERE monitor_session_id=" + key + " ORDER BY started_at");
            assertTrue(excluded.next());
            assertEquals("UNMEASURABLE", excluded.getString(1));
            assertEquals(500_000, excluded.getLong(2));
            assertTrue(excluded.next());
            assertEquals("MISSING", excluded.getString(1));
            assertEquals(1_000_000, excluded.getLong(2));
            assertFalse(excluded.next());
        }
    }

    @Test
    void realtimeV2DisconnectEndsTheSessionAtTheLastInterval() throws Exception {
        var api = client();
        api.register(email());
        UUID id = UUID.randomUUID(), baseline = baseline(api);
        assertEquals(200, api.put("/v2/sessions/" + id, create(baseline)).status());
        var socket = Socket.open(port);
        socket.send(helloV2(api, "measure", id));
        socket.next("ready");
        for (long sequence = 0; sequence < 4; sequence++) socket.send(frames(sequence, "running", 0.0));
        JsonNode ack;
        do ack = socket.next("ack");
        while (ack.get("last_sequence").asLong() != 3);
        socket.abort();

        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        JsonNode view;
        do view = api.get("/v2/sessions/" + id).body();
        while (!view.get("ended").asBoolean() && System.nanoTime() < deadline);
        assertTrue(view.get("ended").asBoolean());
        assertEquals(2000, view.get("summary").get("total_ms").asLong());
        assertEquals(2000, view.get("summary").get("normal_ms").asLong());
    }

    /** 시험용 최소 WebSocket 클라이언트. 메시지를 받은 순서대로 보관한다. */
    private static final class Socket implements WebSocket.Listener {
        private final LinkedBlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        private final StringBuilder partial = new StringBuilder();
        private WebSocket socket;

        static Socket open(int port) throws Exception {
            var listener = new Socket();
            var builder = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", "http://127.0.0.1:" + port);
            listener.socket =
                    builder.buildAsync(URI.create("ws://127.0.0.1:" + port + "/v2/realtime"), listener)
                            .get(5, TimeUnit.SECONDS);
            return listener;
        }

        /** 앱이 끊긴 것처럼 연결을 끊는다(closed를 주고받지 않음). */
        void abort() {
            socket.abort();
        }

        void send(JsonNode message) throws Exception {
            socket.sendText(MAPPER.writeValueAsString(message), true).get(5, TimeUnit.SECONDS);
        }

        /** {@code type}(주어지면 사건 종류까지) 맞는 다음 메시지. 나머지는 건너뛴다. */
        JsonNode next(String type, String... kind) throws Exception {
            long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            while (System.nanoTime() < deadline) {
                var message = messages.poll(100, TimeUnit.MILLISECONDS);
                if (message == null) continue;
                if (!type.equals(message.get("type").asString())) continue;
                if (kind.length > 0 && !kind[0].equals(message.get("event").get("kind").asString())) continue;
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
