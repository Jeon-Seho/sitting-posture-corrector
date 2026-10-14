package org.posegood.api.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Jackson 3 전환 뒤에도 입력 검사가 Jackson 2 때와 같게 동작하는지 시험한다. 합성 JSON만 쓴다. */
class JsonTest {
    private final JsonMapper plain = JsonMapper.builder().build();

    @Test
    void textMatchesJackson2AsTextForEveryNodeKind() {
        JsonNode node = plain.readTree("{\"s\":\"x\",\"i\":5,\"b\":true,\"z\":null,\"o\":{},\"a\":[1]}");
        assertEquals("x", Json.text(node.get("s")));
        assertEquals("5", Json.text(node.get("i")));
        assertEquals("true", Json.text(node.get("b")));
        assertEquals("null", Json.text(node.get("z")));
        // Jackson 3 asString() throws here; a malformed request must stay a 400, not a 500.
        assertEquals("", Json.text(node.get("o")));
        assertEquals("", Json.text(node.get("a")));
        assertEquals("", Json.text(node.path("missing")));
        assertEquals("", Json.text(null));
    }

    @Test
    void textWithFallbackReturnsItOnlyForMissingOrNull() {
        JsonNode node = plain.readTree("{\"s\":\"1.0\",\"z\":null,\"o\":{}}");
        assertEquals("1.0", Json.text(node.path("s"), null));
        assertNull(Json.text(node.path("z"), null));
        assertNull(Json.text(node.path("missing"), null));
        assertEquals("", Json.text(node.path("o"), null));
    }

    @Test
    void duplicateKeysAreRejected() {
        var builder = JsonMapper.builder();
        new JsonConfiguration().strictDuplicateDetection().customize(builder);
        var strict = builder.build();
        assertThrows(JacksonException.class, () -> strict.readTree("{\"id\":\"a\",\"id\":\"b\"}"));
        assertEquals("a", strict.readTree("{\"id\":\"a\"}").get("id").stringValue());
    }
}
