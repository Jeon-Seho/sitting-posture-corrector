package org.posegood.contracts;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
public record CreateSession(@NotNull @Valid Policy policy) {}
