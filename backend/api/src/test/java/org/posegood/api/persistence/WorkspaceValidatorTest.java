package org.posegood.api.persistence;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.posegood.contracts.ContractError;

class WorkspaceValidatorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void rawFeatureFieldsAndNonfiniteOrUnknownSettingsAreRejected() throws Exception {
        var rules =
                mapper.readTree(
                        "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.7}");
        assertDoesNotThrow(() -> WorkspaceValidator.rules(rules));
        var altered = rules.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) altered).put("features", 123);
        assertThrows(ContractError.class, () -> WorkspaceValidator.rules(altered));
        var nan = rules.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) nan).put("threshold", Double.NaN);
        assertThrows(ContractError.class, () -> WorkspaceValidator.rules(nan));
    }

    @Test
    void aggregateRecordCannotContainCoordinatesOrNegativeDurations() throws Exception {
        var record =
                mapper.readTree(
                        "{\"id\":\"synthetic\",\"startedAt\":\"2026-01-01T00:00:00Z\",\"endedAt\":\"2026-01-01T00:00:01Z\",\"mode\":\"demo\",\"valid\":1,\"good\":1,\"total\":1,\"events\":[]}");
        assertDoesNotThrow(() -> WorkspaceValidator.record(record));
        var leaked = record.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) leaked).putArray("landmarks");
        assertThrows(ContractError.class, () -> WorkspaceValidator.record(leaked));
        var negative = record.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) negative).put("total", -1);
        assertThrows(ContractError.class, () -> WorkspaceValidator.record(negative));
    }
}
