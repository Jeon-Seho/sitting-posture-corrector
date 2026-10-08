package org.posegood.contracts;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import java.util.List;

/** Internal authenticated replay of verified original observations; no feature requests. */
public record RestoreSession(
        @NotNull @Valid Policy policy,
        @NotNull @Size(max = 10000) List<@NotNull @Valid Observation> observations,
        @Min(0) @Max(86400000) Long endMs) {}
