package org.posegood.api.common;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonMappingException;

import org.springframework.boot.jackson.JsonComponent;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * UUID는 표준 36자 문자열만 받는다(다른 표기는 400).
 *
 * Jackson이 받아 주는 Base64 형식 등은 거부한다.
 */
@JsonComponent
public class CanonicalUuidDeserializer extends JsonDeserializer<UUID> {
    public static final Pattern CANONICAL =
            Pattern.compile(
                    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    @Override
    public UUID deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (!parser.hasToken(JsonToken.VALUE_STRING)
                || !CANONICAL.matcher(parser.getText()).matches()) {
            throw JsonMappingException.from(parser, "UUID must use canonical text");
        }
        return UUID.fromString(parser.getText());
    }
}
