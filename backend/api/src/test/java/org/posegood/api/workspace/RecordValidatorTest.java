package org.posegood.api.workspace;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.posegood.api.common.ApiError;

/**
 * 기록 형식 검사 시험.
 *
 * 손으로 쓴 합성 앱 기록 JSON만 쓴다.
 */
class RecordValidatorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    private ObjectNode record() throws Exception {
        return (ObjectNode)
                mapper.readTree(
                        """
                        {"id":"local-1","startedAt":"2026-10-09T01:00:00Z","endedAt":"2026-10-09T01:01:00Z",
                         "mode":"camera","valid":50,"good":40,"total":60,
                         "rules":{"holdSeconds":3,"recoverSeconds":3,"realertSeconds":60,"threshold":0.5},
                         "events":[{"id":1,"type":"tilt","startAt":10,"confirmedAt":13,"endAt":20,
                           "durationSec":10,"alerts":1,"blockId":0,"recovered":true,"endedBySession":false,
                           "endReason":null,"firstAlertAt":13,"recoverySec":7,"validStartAt":9}]}
                        """);
    }

    @Test
    void acceptsAConsistentRecord() throws Exception {
        assertDoesNotThrow(() -> RecordValidator.record(record()));
    }

    @Test
    void rejectsInconsistentTotalsAndEvents() throws Exception {
        var good = record();
        good.put("good", 55);
        assertEquals(400, assertThrows(ApiError.class, () -> RecordValidator.record(good)).status());

        var duration = record();
        ((ObjectNode) duration.get("events").get(0)).put("durationSec", 9);
        assertThrows(ApiError.class, () -> RecordValidator.record(duration));

        var unknown = record();
        unknown.put("extra", true);
        assertThrows(ApiError.class, () -> RecordValidator.record(unknown));

        var recovered = record();
        ((ObjectNode) recovered.get("events").get(0)).put("endReason", "paused");
        assertThrows(ApiError.class, () -> RecordValidator.record(recovered));
    }

    @Test
    void serverRecordsNeedACameraModeRulesAndASessionUuid() throws Exception {
        var server = record();
        server.putObject("server")
                .put("baselineId", "00000000-0000-4000-8000-000000000002")
                .put("modelVersion", "reference-feature-rule-v1")
                .put("confirmed", true)
                .putNull("view");
        assertThrows(ApiError.class, () -> RecordValidator.record(server));
        server.put("id", "00000000-0000-4000-8000-000000000003");
        assertDoesNotThrow(() -> RecordValidator.record(server));
        server.put("mode", "demo");
        assertThrows(ApiError.class, () -> RecordValidator.record(server));
    }

    @Test
    void settingsRangesFollowTheApp() throws Exception {
        assertDoesNotThrow(
                () ->
                        RecordValidator.rules(
                                mapper.readTree(
                                        "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.5}")));
        assertThrows(
                ApiError.class,
                () ->
                        RecordValidator.rules(
                                mapper.readTree(
                                        "{\"holdSeconds\":0,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.5}")));
    }
}
