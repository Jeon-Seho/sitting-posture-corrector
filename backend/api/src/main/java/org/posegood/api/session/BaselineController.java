package org.posegood.api.session;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import org.posegood.api.account.AccountService;
import org.posegood.api.account.CurrentUser;
import org.posegood.api.account.UserLocks;
import org.posegood.api.common.ApiError;
import org.posegood.api.contract.SessionRequests;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Measurement-independent registration and current baseline lookup. */
@RestController
@RequestMapping("/v2/baselines")
public class BaselineController {
    private final BaselineRepository baselines;
    private final CurrentUser current;
    private final AccountService accounts;
    private final UserLocks locks;
    private final TransactionTemplate tx;

    public BaselineController(BaselineRepository baselines, CurrentUser current, AccountService accounts,
                              UserLocks locks, TransactionTemplate tx) {
        this.baselines = baselines; this.current = current; this.accounts = accounts; this.locks = locks; this.tx = tx;
    }

    @GetMapping("/current")
    public BaselineRepository.View current() {
        long owner = current.id();
        accounts.requireActive(owner);
        var baseline = baselines.current(owner);
        if (baseline == null) throw new ApiError(404, "BASELINE_NOT_FOUND", "register a baseline first");
        return baseline.view();
    }

    @PostMapping
    public BaselineRepository.View register(@Valid @RequestBody Registration body) {
        long owner = current.id();
        return locks.withLock(owner, () -> tx.execute(status -> {
            accounts.requireActive(owner);
            return baselines.register(owner, body.registrationId(), body.landmarks()).view();
        }));
    }

    /** {@code registration_id} is issued once per capture by the app and repeated on retries (ADR 0028). */
    public record Registration(@NotNull UUID registrationId, @Min(3000) @Max(999900) long calibrationMs,
                               @Min(20) @Max(100000) int sampleCount,
                               @NotNull @Valid SessionRequests.Landmarks landmarks) {}
}
