package org.posegood.contracts;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.PositiveOrZero;

public record EndSession(@PositiveOrZero @Max(86400000) long endMs) {}
