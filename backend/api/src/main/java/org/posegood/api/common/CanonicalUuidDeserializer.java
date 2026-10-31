package org.posegood.api.common;

import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.boot.jackson.JacksonComponent;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DatabindException;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/**
 * UUID는 표준 36자 문자열만 받는다(다른 표기는 400).
 *
 * Jackson이 받아 주는 Base64 형식 등은 거부한다.
 */
@JacksonComponent
public class CanonicalUuidDeserializer extends ValueDeserializer<UUID> {
	public static final Pattern CANONICAL = Pattern.compile(
		"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

	@Override
	public UUID deserialize(JsonParser parser, DeserializationContext context) {
		if (!parser.hasToken(JsonToken.VALUE_STRING)
			|| !CANONICAL.matcher(parser.getString()).matches()) {
			throw DatabindException.from(parser, "UUID must use canonical text");
		}
		return UUID.fromString(parser.getString());
	}
}
