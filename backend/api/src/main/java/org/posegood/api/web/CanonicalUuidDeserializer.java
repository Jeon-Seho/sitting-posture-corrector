package org.posegood.api.web;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonMappingException;

import org.springframework.boot.jackson.JsonComponent;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/** The wire contract accepts canonical UUID text, not Jackson's alternate Base64 form. */
@JsonComponent
public class CanonicalUuidDeserializer extends JsonDeserializer<UUID> {
    private static final Pattern CANONICAL =
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
