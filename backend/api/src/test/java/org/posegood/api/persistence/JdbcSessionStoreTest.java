package org.posegood.api.persistence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;

class JdbcSessionStoreTest {
    private final UUID sessionId = UUID.randomUUID();
    private final ObjectMapper mapper = new ObjectMapper();
    private final JsonCodec json = new JsonCodec(mapper);
    private final RecordingJdbc jdbc = new RecordingJdbc();
    private final JdbcSessionStore store = store();

    @Test
    void growingHistoryWritesOnlyItsNewSuffixAndKeepsOneFullView() throws Exception {
        var oldEvents = events(100);
        var nextEvents = events(101);
        var old = view(100, oldEvents);
        var next = view(101, nextEvents);
        jdbc.proofs.put(digest(old), json.write(old));
        store.confirm(stored(old), input(101), next);

        assertEquals(List.of(), jdbc.collapseWrites);
        assertEquals(1, jdbc.alertWrites);
        var demoted = mapper.readTree(jdbc.proofs.get(digest(old)));
        assertEquals(100, demoted.get("event_count").asInt());
        assertFalse(demoted.has("events"));
        assertFalse(demoted.has("summary"));
        assertTrue(jdbc.proofs.get(digest(old)).length() < 250);
        assertTrue(mapper.readTree(jdbc.proofs.get(digest(next))).has("events"));
        assertTrue(store.wasConfirmed(sessionId, old));
        assertTrue(store.wasConfirmed(sessionId, next));

        var later = view(102, nextEvents);
        store.confirm(stored(next), input(102), later);
        assertEquals(1, jdbc.alertWrites);
        assertEquals(
                1,
                jdbc.proofs.values().stream().filter(value -> value.contains("\"events\"")).count());
        assertTrue(store.wasConfirmed(sessionId, next));
        assertTrue(store.wasConfirmed(sessionId, later));
    }

    @Test
    void changedConfirmedEventPrefixIsRejectedBeforeAnyDatabaseWrite() {
        var original = events(1);
        var event = original.getFirst();
        var changed =
                new DecisionEvent(
                        event.schemaVersion(),
                        event.sessionId(),
                        event.eventId(),
                        event.kind(),
                        event.timestampMs() + 1,
                        event.onsetMs(),
                        event.onsetValidMs(),
                        event.deviationType(),
                        event.reason());
        var error =
                assertThrows(
                        ContractError.class,
                        () ->
                                store.confirm(
                                        stored(view(1, original)),
                                        input(2),
                                        view(2, List.of(changed))));
        assertEquals(502, error.status());
        assertEquals(0, jdbc.writeCount);
        assertTrue(jdbc.collapseWrites.isEmpty());
    }

    @Test
    void proofRejectsAlteredEventContentAndAlteredProofMetadata() throws Exception {
        var confirmed = view(1, events(1));
        store.confirm(stored(view(0, List.of())), input(1), confirmed);
        store.confirm(stored(confirmed), input(2), view(2, events(1)));
        assertEquals(List.of(1), jdbc.collapseWrites);
        var event = confirmed.events().getFirst();
        var altered =
                new DecisionEvent(
                        event.schemaVersion(),
                        event.sessionId(),
                        event.eventId(),
                        event.kind(),
                        event.timestampMs() + 1,
                        event.onsetMs(),
                        event.onsetValidMs(),
                        event.deviationType(),
                        event.reason());
        assertFalse(store.wasConfirmed(sessionId, view(1, List.of(altered))));

        var proof = (ObjectNode) mapper.readTree(jdbc.proofs.get(digest(confirmed)));
        proof.put("event_count", 0);
        jdbc.proofs.put(digest(confirmed), mapper.writeValueAsString(proof));
        assertFalse(store.wasConfirmed(sessionId, confirmed));
    }

    @Test
    void previouslyStoredFullViewProofRemainsUsableWithoutDdlChanges() {
        var confirmed = view(1, events(1));
        jdbc.proofs.put(digest(confirmed), json.write(confirmed));
        assertTrue(store.wasConfirmed(sessionId, confirmed));
        assertFalse(store.wasConfirmed(sessionId, view(2, events(1))));
    }

    private JdbcSessionStore store() {
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
        return new JdbcSessionStore(
                jdbc,
                json,
                new TransactionTemplate(manager),
                new ThresholdPolicyStore(jdbc, "DEFAULT_TEMP"));
    }

    private String digest(SessionView view) {
        return json.fingerprint(json.tree(view));
    }

    private JdbcSessionStore.Stored stored(SessionView view) {
        return new JdbcSessionStore.Stored(
                7,
                sessionId,
                42,
                Policy.defaults(),
                view,
                UUID.randomUUID(),
                "reference-feature-rule-v1",
                true,
                "synthetic-device",
                640,
                480,
                Instant.EPOCH,
                null);
    }

    private JdbcSessionStore.Input input(long sequence) {
        return new JdbcSessionStore.Input(
                JdbcSessionStore.FEATURE,
                "f".repeat(64),
                new Observation(
                        "2.0",
                        sequence,
                        sequence * 1000,
                        (sequence + 1) * 1000,
                        Observation.Phase.running,
                        true,
                        .9,
                        Observation.DeviationType.left_lean,
                        "reference-feature-rule-v1"),
                JdbcSessionStore.PENDING,
                0);
    }

    private SessionView view(long sequence, List<DecisionEvent> events) {
        long total = sequence * 1000;
        return new SessionView(
                "1.0",
                sessionId,
                Policy.defaults(),
                "legacy-interrupt-v1",
                false,
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
                        1,
                        events.size(),
                        0.0,
                        total == 0 ? null : events.size() * 3600000.0 / total,
                        0,
                        null,
                        null),
                events);
    }

    private List<DecisionEvent> events(int count) {
        List<DecisionEvent> result = new ArrayList<>();
        for (int n = 1; n <= count; n++)
            result.add(
                    new DecisionEvent(
                            "1.0",
                            sessionId,
                            n,
                            n == 1 ? "collapse_confirmed" : "reminder",
                            n * 1000L,
                            0,
                            0,
                            "left_lean",
                            null));
        return result;
    }

    /** Simulates `confirmed_snapshot` and episode writes; actual SQL runs in MySQL tests. */
    private static class RecordingJdbc extends JdbcTemplate {
        final Map<String, String> proofs = new LinkedHashMap<>();
        final List<Integer> collapseWrites = new ArrayList<>();
        int alertWrites;
        int writeCount;

        @Override
        public int update(String sql, Object... args) {
            writeCount++;
            if (sql.startsWith("UPDATE confirmed_snapshot"))
                proofs.put((String) args[2], (String) args[0]);
            if (sql.startsWith("INSERT INTO confirmed_snapshot"))
                proofs.put((String) args[1], (String) args[2]);
            if (sql.startsWith("INSERT INTO collapse_event")) collapseWrites.add((Integer) args[1]);
            if (sql.startsWith("INSERT INTO correction_alert")) alertWrites++;
            return 1;
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            List<String[]> rows = new ArrayList<>();
            if (sql.startsWith("SELECT snapshot_fingerprint,payload")) {
                proofs.forEach(
                        (digest, payload) -> {
                            if (payload.contains("\"events\""))
                                rows.add(new String[] {digest, payload});
                        });
            } else {
                String payload = proofs.get(args[1]);
                if (payload != null) rows.add(new String[] {payload, null});
            }
            List<T> result = new ArrayList<>();
            for (var values : rows) {
                var row = mock(ResultSet.class);
                try {
                    when(row.getString(1)).thenReturn(values[0]);
                    when(row.getString(2)).thenReturn(values[1]);
                    result.add(rowMapper.mapRow(row, 0));
                } catch (SQLException error) {
                    throw new AssertionError(error);
                }
            }
            return result;
        }

        @Override
        public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
            return List.of(type.cast(1));
        }

        @Override
        public <T> T queryForObject(String sql, Class<T> type, Object... args) {
            return type.cast(collapseWrites.size() + 1);
        }
    }
}
