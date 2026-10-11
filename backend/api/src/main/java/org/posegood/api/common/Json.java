package org.posegood.api.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.TreeMap;

/** The application's single ObjectMapper (snake_case, strict) plus canonical SHA-256 digests. */
@Component
public class Json {
    private final ObjectMapper mapper;

    public Json(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public ObjectMapper mapper() {
        return mapper;
    }

    public String write(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("serialization failed");
        }
    }

    public <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("stored JSON is invalid");
        }
    }

    /** Converts client input; any mismatch is a 400 without echoing the value. */
    public <T> T convert(JsonNode value, Class<T> type) {
        try {
            return mapper.treeToValue(value, type);
        } catch (JsonProcessingException | IllegalArgumentException invalid) {
            throw ApiError.badRequest("invalid contract");
        }
    }

    public JsonNode tree(Object value) {
        return mapper.valueToTree(value);
    }

    /** Key order and number formatting do not change the digest of the same JSON value. */
    public String fingerprint(JsonNode value) {
        return sha256(write(sorted(value)).getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private JsonNode sorted(JsonNode value) {
        if (value.isObject()) {
            ObjectNode result = mapper.createObjectNode();
            var fields = new TreeMap<String, JsonNode>();
            value.properties().forEach(entry -> fields.put(entry.getKey(), entry.getValue()));
            fields.forEach((key, child) -> result.set(key, sorted(child)));
            return result;
        }
        if (value.isArray()) {
            ArrayNode result = mapper.createArrayNode();
            value.forEach(child -> result.add(sorted(child)));
            return result;
        }
        if (value.isNumber())
            return mapper.getNodeFactory().numberNode(value.decimalValue().stripTrailingZeros());
        return value;
    }
}
