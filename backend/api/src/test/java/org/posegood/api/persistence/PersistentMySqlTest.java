package org.posegood.api.persistence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.posegood.api.account.UserStore;
import org.posegood.api.gateway.CepGateway;
import org.posegood.api.gateway.InferenceGateway;
import org.posegood.contracts.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.*;

/** Actual MySQL/Flyway/JDBC/session integration. Every account and input is synthetic. */
@SpringBootTest(
        properties = {
            "posegood.internal-token=synthetic_internal_test_token_1234567890",
            "posegood.recovery-enabled=false"
        })
@ActiveProfiles("persistent")
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "posegood.mysql.integration", matches = "true")
class PersistentMySqlTest {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry values) {
        if (!"true".equals(System.getenv("POSEGOOD_TEST_MYSQL_DISPOSABLE"))
                || !"true".equals(System.getenv("POSEGOOD_TEST_MYSQL_SYNTHETIC")))
            throw new IllegalStateException("disposable synthetic MySQL guard required");
        String url = required("POSEGOOD_TEST_MYSQL_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/posegood(?:\\?.*)?"))
            throw new IllegalStateException(
                    "test MySQL must use the disposable loopback Compose database");
        String user = required("POSEGOOD_TEST_MYSQL_USER"),
                password = required("POSEGOOD_TEST_MYSQL_PASSWORD");
        values.add("spring.datasource.url", () -> url);
        values.add("spring.datasource.username", () -> user);
        values.add("spring.datasource.password", () -> password);
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank())
            throw new IllegalStateException("synthetic MySQL test configuration missing");
        return value;
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserStore users;
    @Autowired JdbcSessionStore store;
    @Autowired org.posegood.api.account.CurrentUser currentUser;
    @MockitoBean CepGateway cep;
    @MockitoBean InferenceGateway inference;
    private final List<UUID> accounts = new ArrayList<>();
    private final Set<UUID> fixtureSessions = new HashSet<>();
    private final Map<UUID, SessionView> engines = new HashMap<>();
    private static final String PASSWORD = "synthetic-test-password-123";

    @BeforeEach
    void setup() {
        reset(cep, inference);
        engines.clear();
        when(cep.get(any()))
                .thenAnswer(
                        call -> {
                            var view = engines.get(call.getArgument(0));
                            if (view == null)
                                throw new ContractError(404, "synthetic missing CEP engine");
                            return view;
                        });
        when(cep.restore(any(), any()))
                .thenAnswer(
                        call -> {
                            UUID id = call.getArgument(0);
                            RestoreSession request = call.getArgument(1);
                            var view = view(id, -1, 0, false);
                            for (var item : request.observations())
                                view = view(id, item.sequence(), item.endMs(), false);
                            engines.put(id, view);
                            return view;
                        });
        when(cep.observe(any(), any()))
                .thenAnswer(
                        call -> {
                            UUID id = call.getArgument(0);
                            Observation item = call.getArgument(1);
                            var view = view(id, item.sequence(), item.endMs(), false);
                            engines.put(id, view);
                            return view;
                        });
        when(cep.end(any(), any()))
                .thenAnswer(
                        call -> {
                            UUID id = call.getArgument(0);
                            EndSession end = call.getArgument(1);
                            var view = view(id, engines.get(id).lastSequence(), end.endMs(), true);
                            engines.put(id, view);
                            return view;
                        });
        doAnswer(
                        call -> {
                            engines.remove(call.getArgument(0));
                            return null;
                        })
                .when(cep)
                .delete(any());
        when(inference.infer(any()))
                .thenAnswer(
                        call -> {
                            InferenceRequest request = call.getArgument(0);
                            return new Observation(
                                    "2.0",
                                    request.sequence(),
                                    request.startMs(),
                                    request.endMs(),
                                    request.phase(),
                                    true,
                                    .9,
                                    Observation.DeviationType.left_lean,
                                    "reference-feature-rule-v1");
                        });
    }

    @AfterEach
    void cleanup() {
        for (var id : accounts) users.delete(id);
        for (var id : fixtureSessions) store.cleanupComplete(id);
        fixtureSessions.clear();
        accounts.clear();
    }

    private SessionView view(UUID id, long sequence, long total, boolean ended) {
        List<DecisionEvent> events = new ArrayList<>();
        if (total >= 3000)
            events.add(
                    new DecisionEvent(
                            "1.0", id, 1, "collapse_confirmed", 3000, 0, 0, "left_lean", null));
        if (ended) {
            if (total >= 3000)
                events.add(
                        new DecisionEvent(
                                "1.0", id, 2, "interrupted", total, 0, 0, "left_lean", "ended"));
            events.add(
                    new DecisionEvent(
                            "1.0",
                            id,
                            events.size() + 1,
                            "session_ended",
                            total,
                            total,
                            total,
                            "none",
                            "ended"));
        }
        return new SessionView(
                "1.0",
                id,
                Policy.defaults(),
                "legacy-interrupt-v1",
                ended,
                sequence,
                new Summary(
                        total,
                        total,
                        0,
                        total,
                        0,
                        0,
                        0,
                        0,
                        total >= 3000 ? 1 : 0,
                        total >= 3000 ? 1 : 0,
                        total == 0 ? null : 0.0,
                        total == 0 ? null : (total >= 3000 ? 3600000.0 / total : 0.0),
                        0,
                        null,
                        null),
                events);
    }

    private final class Client {
        Cookie cookie;
        String csrf;
        UUID owner;

        Client() throws Exception {
            refresh();
        }

        void refresh() throws Exception {
            var result = request(get("/v1/auth/csrf"), false, null);
            assertEquals(200, result.getResponse().getStatus());
            csrf = body(result).get("token").asText();
        }

        MvcResult request(MockHttpServletRequestBuilder request, boolean mutation, Object payload)
                throws Exception {
            if (cookie != null) request.cookie(cookie);
            if (owner != null) request.header("X-PoseGood-User-Id", owner.toString());
            if (mutation) request.header("X-CSRF-TOKEN", csrf);
            if (payload != null)
                request.contentType("application/json").content(mapper.writeValueAsString(payload));
            var result = mvc.perform(request).andReturn();
            for (String header : result.getResponse().getHeaders("Set-Cookie"))
                if (header.startsWith("SESSION=")) {
                    String value = header.substring(8).split(";", 2)[0];
                    cookie = new Cookie("SESSION", value);
                }
            return result;
        }

        void signup() throws Exception {
            var result =
                    request(
                            post("/v1/auth/register"),
                            true,
                            Map.of(
                                    "email",
                                    "synthetic-" + UUID.randomUUID() + "@example.invalid",
                                    "password",
                                    PASSWORD,
                                    "profile",
                                    Map.of(
                                            "name",
                                            "Synthetic fixture",
                                            "age",
                                            30,
                                            "occupation",
                                            "Synthetic test"),
                                    "consent_version",
                                    "service-v1"));
            assertEquals(
                    200,
                    result.getResponse().getStatus(),
                    result.getResponse().getContentAsString());
            owner = UUID.fromString(body(result).get("user_id").asText());
            accounts.add(owner);
            refresh();
        }

        UUID create() throws Exception {
            var id = UUID.randomUUID();
            fixtureSessions.add(id);
            assertStatus(
                    200,
                    request(put("/v1/sessions/" + id), true, Map.of("policy", Policy.defaults())));
            return id;
        }

        MvcResult feature(UUID id, int sequence, UUID baseline) throws Exception {
            return request(
                    post("/v1/sessions/" + id + "/features"),
                    true,
                    Map.of(
                            "schema_version",
                            "2.0",
                            "feature_version",
                            "shoulder-relative-deltas-v1",
                            "baseline_id",
                            baseline.toString(),
                            "sequence",
                            sequence,
                            "start_ms",
                            sequence * 1000,
                            "end_ms",
                            (sequence + 1) * 1000,
                            "phase",
                            "running",
                            "measurement_quality",
                            "good",
                            "features",
                            Map.of(
                                    "head_gap_delta",
                                    0,
                                    "lateral_offset_delta",
                                    .3,
                                    "shoulder_tilt_delta",
                                    0,
                                    "current_quality",
                                    1,
                                    "baseline_quality",
                                    1)));
        }
    }

    private JsonNode body(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private void assertStatus(int expected, MvcResult result) throws Exception {
        assertEquals(
                expected,
                result.getResponse().getStatus(),
                result.getResponse().getContentAsString());
    }

    @Test
    void actualDatabaseAuthenticationRequiresCsrfAndGuardsStaleIdentity() throws Exception {
        var client = new Client();
        client.signup();
        assertStatus(200, client.request(get("/v1/auth/me"), false, null));
        String hash =
                jdbc.queryForObject(
                        "SELECT password_hash FROM users WHERE id=?",
                        String.class,
                        client.owner.toString());
        assertNotEquals(PASSWORD, hash);
        assertTrue(hash.startsWith("$2a$"));
        assertEquals(
                403,
                mvc.perform(
                                put("/v1/workspace")
                                        .cookie(client.cookie)
                                        .header("X-PoseGood-User-Id", client.owner)
                                        .contentType("application/json")
                                        .content("{}"))
                        .andReturn()
                        .getResponse()
                        .getStatus());
        assertEquals(
                409,
                mvc.perform(
                                get("/v1/workspace")
                                        .cookie(client.cookie)
                                        .header("X-PoseGood-User-Id", UUID.randomUUID()))
                        .andReturn()
                        .getResponse()
                        .getStatus());
        assertStatus(
                400,
                client.request(
                        put("/v1/auth/password"),
                        true,
                        Map.of(
                                "current_password",
                                "synthetic-wrong",
                                "new_password",
                                "synthetic-new-password-123")));
        assertStatus(200, client.request(get("/v1/auth/me"), false, null));
        assertStatus(204, client.request(post("/v1/auth/logout"), true, null));
        assertStatus(401, client.request(get("/v1/auth/me"), false, null));
    }

    @Test
    void ownerIsolationIncludesCreateFeaturesReadEndAndDelete() throws Exception {
        var first = new Client();
        first.signup();
        var id = first.create();
        var second = new Client();
        second.signup();
        assertStatus(404, second.request(get("/v1/sessions/" + id), false, null));
        assertStatus(
                404,
                second.request(
                        put("/v1/sessions/" + id), true, Map.of("policy", Policy.defaults())));
        assertStatus(404, second.feature(id, 0, UUID.randomUUID()));
        assertStatus(
                404,
                second.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 0)));
        assertStatus(404, second.request(delete("/v1/sessions/" + id), true, null));
        verifyNoInteractions(inference);
        assertStatus(200, first.request(get("/v1/sessions/" + id), false, null));
    }

    @Test
    void outputAndOutboxAreDurableBeforeForwardingAndLostAckUsesOriginalInference()
            throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var baseline = UUID.randomUUID();
        doAnswer(
                        call -> {
                            assertEquals("pending", store.input(id, 0).status());
                            assertEquals(
                                    0L, store.require(client.owner, id).view().summary().totalMs());
                            assertEquals(
                                    0,
                                    jdbc.queryForObject(
                                            "SELECT completed FROM cep_outbox WHERE session_id=?",
                                            Integer.class,
                                            id.toString()));
                            engines.put(id, view(id, 0, 1000, false));
                            throw new ContractError(
                                    502, "synthetic response lost after CEP acceptance");
                        })
                .doAnswer(
                        call -> {
                            var result = view(id, 0, 1000, false);
                            engines.put(id, result);
                            return result;
                        })
                .when(cep)
                .observe(eq(id), any());
        assertStatus(502, client.feature(id, 0, baseline));
        assertEquals(-1, store.require(client.owner, id).view().lastSequence());
        assertStatus(
                409,
                client.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 1000)));
        assertStatus(409, client.feature(id, 1, baseline));
        assertStatus(200, client.feature(id, 0, baseline));
        assertStatus(200, client.feature(id, 0, baseline));
        verify(inference, times(1)).infer(any());
        assertEquals("accepted", store.input(id, 0).status());
        assertEquals(1000, store.require(client.owner, id).view().summary().totalMs());
    }

    @Test
    void cepOnlyRestartReplaysConfirmedPrefixAndFreezesBaseline() throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var baseline = UUID.randomUUID();
        for (int n = 0; n < 3; n++) assertStatus(200, client.feature(id, n, baseline));
        var before = store.require(client.owner, id).view();
        engines.clear();
        assertStatus(200, client.feature(id, 3, baseline));
        assertEquals(before.events(), store.require(client.owner, id).view().events());
        verify(cep, atLeast(2)).restore(eq(id), any());
        assertStatus(409, client.feature(id, 4, UUID.randomUUID()));
        assertEquals(baseline, store.require(client.owner, id).baseline());
        assertEquals(4, store.inputCount(id));
    }

    @Test
    void durableEndAfterResponseLossKeepsSameEndAndCanRecoverWithoutMemory() throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var baseline = UUID.randomUUID();
        for (int n = 0; n < 3; n++) assertStatus(200, client.feature(id, n, baseline));
        doAnswer(
                        call -> {
                            engines.put(id, view(id, 2, 3000, true));
                            throw new ContractError(502, "synthetic termination ACK lost");
                        })
                .doAnswer(
                        call -> {
                            var result = view(id, 2, 3000, true);
                            engines.put(id, result);
                            return result;
                        })
                .when(cep)
                .end(eq(id), any());
        assertStatus(
                502,
                client.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 3000)));
        assertFalse(store.require(client.owner, id).view().ended());
        assertEquals(3000L, store.require(client.owner, id).endMs());
        assertStatus(
                409,
                client.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 4000)));
        assertStatus(
                200,
                client.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 3000)));
        engines.clear();
        assertStatus(
                200,
                client.request(post("/v1/sessions/" + id + "/end"), true, Map.of("end_ms", 3000)));
        assertTrue(store.require(client.owner, id).view().ended());
        assertNotNull(store.require(client.owner, id).endedAt());
        verify(cep, times(2)).end(eq(id), any());
    }

    @Test
    void transactionRollsBackSnapshotAndDeliveryConfirmationOnImmutableEventConflict()
            throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var baseline = UUID.randomUUID();
        assertStatus(200, client.feature(id, 0, baseline));
        assertStatus(200, client.feature(id, 1, baseline));
        jdbc.update(
                "INSERT INTO session_events(session_id,event_id,payload) VALUES(?,?,?)",
                id.toString(),
                1,
                mapper.writeValueAsString(
                        new DecisionEvent(
                                "1.0",
                                id,
                                1,
                                "collapse_confirmed",
                                2500,
                                0,
                                0,
                                "left_lean",
                                null)));
        assertStatus(502, client.feature(id, 2, baseline));
        assertEquals(1, store.require(client.owner, id).view().lastSequence());
        assertEquals("pending", store.input(id, 2).status());
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT completed FROM cep_outbox WHERE session_id=? AND sequence=2",
                        Integer.class,
                        id.toString()));
        jdbc.update("DELETE FROM session_events WHERE session_id=? AND event_id=1", id.toString());
        assertStatus(200, client.feature(id, 2, baseline));
        verify(inference, times(3)).infer(any());
        assertEquals(2, store.require(client.owner, id).view().lastSequence());
    }

    @Test
    void earlierAcknowledgedArchiveIsValidatedAndRecordsAreIdempotent() throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var baseline = UUID.randomUUID();
        for (int n = 0; n < 3; n++) assertStatus(200, client.feature(id, n, baseline));
        var prefix = store.require(client.owner, id).view();
        assertStatus(200, client.feature(id, 3, baseline));
        ObjectNode record = mapper.createObjectNode();
        record.put("id", id.toString());
        record.put("startedAt", "2026-01-01T00:00:00Z");
        record.put("endedAt", "2026-01-01T00:00:03Z");
        record.put("mode", "camera");
        record.put("valid", 3);
        record.put("good", 0);
        record.put("total", 3);
        record.set("events", ServerRecordProjection.events(prefix, false));
        record.set(
                "rules",
                mapper.readTree(
                        "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.7}"));
        ObjectNode server = record.putObject("server");
        server.put("baselineId", baseline.toString());
        server.put("modelVersion", "reference-feature-rule-v1");
        server.put("confirmed", false);
        server.set("view", mapper.valueToTree(prefix));
        var proofs =
                jdbc.queryForList(
                        "SELECT payload FROM confirmed_snapshots WHERE session_id=?",
                        String.class,
                        id.toString());
        assertEquals(5, proofs.size());
        for (String payload : proofs) {
            var proof = mapper.readTree(payload);
            assertEquals(1, proof.get("proof_version").asInt());
            assertFalse(proof.has("events"));
            assertTrue(payload.length() < 250);
        }
        var forgedPrefix = record.deepCopy();
        ((ObjectNode) forgedPrefix.path("server").path("view").path("events").get(0))
                .put("onset_ms", 1);
        var forgedResponse = client.request(post("/v1/records"), true, forgedPrefix);
        assertStatus(409, forgedResponse);
        assertEquals(
                "record snapshot was not acknowledged",
                body(forgedResponse).get("message").asText());
        var first = client.request(post("/v1/records"), true, record);
        assertStatus(200, first);
        assertNotEquals(record.get("startedAt"), body(first).get("startedAt"));
        assertEquals(body(first), body(client.request(post("/v1/records"), true, record)));
        var tampered = record.deepCopy();
        tampered.put("total", 4);
        assertStatus(409, client.request(post("/v1/records"), true, tampered));
        assertEquals(1, body(client.request(get("/v1/records"), false, null)).size());
        assertStatus(204, client.request(delete("/v1/records/" + id), true, null));
        assertStatus(404, client.request(get("/v1/sessions/" + id), false, null));
    }

    @Test
    void withdrawalAndPasswordChangeRevokeDatabaseSessionsAndCascadeOwnedData() throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        assertStatus(200, client.feature(id, 0, UUID.randomUUID()));
        assertStatus(
                204,
                client.request(delete("/v1/auth/account"), true, Map.of("password", PASSWORD)));
        assertStatus(401, client.request(get("/v1/auth/me"), false, null));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM measurement_sessions WHERE id=?",
                        Integer.class,
                        id.toString()));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM input_results WHERE session_id=?",
                        Integer.class,
                        id.toString()));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?",
                        Integer.class,
                        client.owner.toString()));
        var second = new Client();
        second.signup();
        assertStatus(
                204,
                second.request(
                        put("/v1/auth/password"),
                        true,
                        Map.of(
                                "current_password",
                                PASSWORD,
                                "new_password",
                                "synthetic-replacement-password-123")));
        assertStatus(401, second.request(get("/v1/auth/me"), false, null));
    }

    @Test
    void lateSavedPrincipalCannotReviveAuthenticationAfterPasswordChangeOrWithdrawal()
            throws Exception {
        var client = new Client();
        client.signup();
        var id = client.owner;
        var principal =
                new org.posegood.api.account.AccountPrincipal(id, users.require(id).epoch());
        var oldAuthentication =
                org.springframework.security.authentication.UsernamePasswordAuthenticationToken
                        .authenticated(
                                principal,
                                null,
                                List.of(
                                        new org.springframework.security.core.authority
                                                .SimpleGrantedAuthority("ROLE_USER")));
        users.changePassword(id, "synthetic-revoked-hash");
        try {
            org.springframework.security.core.context.SecurityContextHolder.getContext()
                    .setAuthentication(oldAuthentication);
            assertEquals(401, assertThrows(ContractError.class, currentUser::id).status());
            users.delete(id);
            assertEquals(401, assertThrows(ContractError.class, currentUser::id).status());
        } finally {
            org.springframework.security.core.context.SecurityContextHolder.clearContext();
        }
    }

    @Test
    void boundedRecoveryAndCleanupRotatePastPermanentlyFailedCandidates() throws Exception {
        var client = new Client();
        client.signup();
        Set<UUID> created = new HashSet<>();
        for (int n = 0; n < 33; n++) {
            var id = UUID.randomUUID();
            fixtureSessions.add(id);
            created.add(id);
            var empty = view(id, -1, 0, false);
            var session = store.create(client.owner, id, Policy.defaults(), empty);
            store.queue(
                    session,
                    "feature",
                    "f".repeat(64),
                    UUID.randomUUID(),
                    new Observation(
                            "2.0",
                            0,
                            0,
                            1000,
                            Observation.Phase.running,
                            true,
                            .9,
                            Observation.DeviationType.left_lean,
                            "reference-feature-rule-v1"));
            jdbc.update("INSERT IGNORE INTO cep_cleanup(session_id) VALUES(?)", id.toString());
        }
        var first = store.recoveryCandidates();
        assertEquals(32, first.size());
        var waiting = created.stream().filter(id -> !first.contains(id)).findFirst().orElseThrow();
        first.forEach(store::markRecoveryAttempt);
        assertTrue(store.recoveryCandidates().contains(waiting));
        var cleanup = store.cleanupCandidates();
        assertEquals(32, cleanup.size());
        var cleanupWaiting =
                created.stream().filter(id -> !cleanup.contains(id)).findFirst().orElseThrow();
        cleanup.forEach(store::markCleanupAttempt);
        assertTrue(store.cleanupCandidates().contains(cleanupWaiting));
    }

    @Test
    void emptyAcknowledgedArchiveKeepsUnmeasuredModelAfterFirstOutputWasSaved() throws Exception {
        var client = new Client();
        client.signup();
        var id = client.create();
        var empty = store.require(client.owner, id).view();
        var baseline = UUID.randomUUID();
        doThrow(new ContractError(502, "synthetic first response unavailable"))
                .when(cep)
                .observe(eq(id), any());
        assertStatus(502, client.feature(id, 0, baseline));
        assertEquals("reference-feature-rule-v1", store.require(client.owner, id).modelVersion());
        ObjectNode record = mapper.createObjectNode();
        record.put("id", id.toString());
        record.put("startedAt", "2026-01-01T00:00:00Z");
        record.put("endedAt", "2026-01-01T00:00:00Z");
        record.put("mode", "camera");
        record.put("valid", 0);
        record.put("good", 0);
        record.put("total", 0);
        record.putArray("events");
        record.set(
                "rules",
                mapper.readTree(
                        "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.7}"));
        var server = record.putObject("server");
        server.put("baselineId", baseline.toString());
        server.put("modelVersion", "unmeasured");
        server.put("confirmed", false);
        server.set("view", mapper.valueToTree(empty));
        assertStatus(200, client.request(post("/v1/records"), true, record));
        assertEquals("pending", store.input(id, 0).status());
    }
}
