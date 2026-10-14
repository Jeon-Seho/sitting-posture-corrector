package org.posegood.api.common;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

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
        } catch (JacksonException error) {
            throw new IllegalStateException("serialization failed");
        }
    }

    public <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (JacksonException error) {
            throw new IllegalStateException("stored JSON is invalid");
        }
    }

    /** 클라이언트 입력 변환. 형식이 맞지 않으면 값을 돌려주지 않고 400. */
    public <T> T convert(JsonNode value, Class<T> type) {
        try {
            return mapper.treeToValue(value, type);
        } catch (JacksonException | IllegalArgumentException invalid) {
            throw ApiError.badRequest("invalid contract");
        }
    }

    /**
     * Jackson 2의 {@code asText()}와 같은 글자: 문자열·숫자·논리값은 그 글자, JSON null은 "null",
     * 객체·배열·없는 값은 "". Jackson 3의 {@code asString()}은 객체·배열에서 예외를 던져 형식 오류가
     * 400 대신 500이 되므로 클라이언트 입력에는 이것을 쓴다.
     */
    public static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isContainer()) return "";
        if (node.isNull()) return "null";
        return node.asString();
    }

    /** Jackson 2의 {@code asText(fallback)}와 같다: 없는 값·JSON null이면 {@code fallback}. */
    public static String text(JsonNode node, String fallback) {
        if (node == null || node.isMissingNode() || node.isNull()) return fallback;
        return text(node);
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
