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
    void growingHistoryWritesOnlyItsNewSuffixAndACompactProof() throws Exception {
        var oldEvents = events(100);
        var nextEvents = events(101);
        var old = view(100, oldEvents);
        var next = view(101, nextEvents);
        store.confirm(stored(old), input(101), next);

        assertEquals(List.of(101L), jdbc.eventReads);
        assertEquals(List.of(101L), jdbc.eventWrites);
        var proof = mapper.readTree(jdbc.proofs.get(digest(next)));
        assertEquals(101, proof.get("event_count").asInt());
        assertFalse(proof.has("events"));
        assertFalse(proof.has("summary"));
        assertTrue(jdbc.proofs.get(digest(next)).length() < 250);
        assertTrue(store.wasConfirmed(sessionId, next));

        var later = view(102, nextEvents);
        store.confirm(stored(next), input(102), later);
        assertEquals(List.of(101L), jdbc.eventReads);
        assertEquals(List.of(101L), jdbc.eventWrites);
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
        assertTrue(jdbc.eventReads.isEmpty());
    }

    @Test
    void proofRejectsAlteredEventContentAndAlteredProofMetadata() throws Exception {
        var confirmed = view(1, events(1));
        store.confirm(stored(view(0, List.of())), input(1), confirmed);
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
        return new JdbcSessionStore(jdbc, json, new TransactionTemplate(manager));
    }

    private String digest(SessionView view) {
        return json.fingerprint(json.tree(view));
    }

    private JdbcSessionStore.Stored stored(SessionView view) {
        return new JdbcSessionStore.Stored(
                sessionId,
                UUID.randomUUID(),
                Policy.defaults(),
                view,
                null,
                "reference-feature-rule-v1",
                null,
                Instant.EPOCH,
                null);
    }

    private JdbcSessionStore.Input input(long sequence) {
        return new JdbcSessionStore.Input(
                "feature",
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
                "pending",
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
                            n == 1 ? "collapse_confirmed" : "alert",
                            n * 1000L,
                            0,
                            0,
                            "left_lean",
                            null));
        return result;
    }

    /** Records database traffic without replacing the actual MySQL transaction regressions. */
    private static class RecordingJdbc extends JdbcTemplate {
        final Map<String, String> proofs = new HashMap<>();
        final List<Long> eventReads = new ArrayList<>();
        final List<Long> eventWrites = new ArrayList<>();
        int writeCount;

        @Override
        public int update(String sql, Object... args) {
            writeCount++;
            if (sql.contains("INSERT IGNORE INTO confirmed_snapshots"))
                proofs.put((String) args[1], (String) args[2]);
            if (sql.contains("INSERT IGNORE INTO session_events")) eventWrites.add((Long) args[1]);
            return 1;
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            if (sql.contains("FROM session_events")) {
                eventReads.add((Long) args[1]);
                return List.of();
            }
            String payload = proofs.get(args[1]);
            if (payload == null) return List.of();
            var row = mock(ResultSet.class);
            try {
                when(row.getString(1)).thenReturn(payload);
                return List.of(rowMapper.mapRow(row, 0));
            } catch (SQLException error) {
                throw new AssertionError(error);
            }
        }
    }
}
