package org.posegood.contracts;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Max;
public record EndSession(@PositiveOrZero @Max(86400000) long endMs) {}
