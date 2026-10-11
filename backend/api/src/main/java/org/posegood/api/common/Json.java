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

/**
 * 공용 JSON 도구: 읽기·쓰기·변환, 재전송 비교용 SHA-256 지문.
 *
 * 앱 전체가 쓰는 ObjectMapper 하나(snake_case, 엄격한 검사)를 감싼다.
 */
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

    /** 클라이언트 입력 변환. 형식이 맞지 않으면 값을 돌려주지 않고 400. */
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

    /** 같은 JSON 값이면 키 순서·숫자 표기가 달라도 같은 지문이 나온다. */
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
