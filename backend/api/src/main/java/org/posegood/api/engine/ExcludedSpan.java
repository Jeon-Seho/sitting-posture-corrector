package org.posegood.api.engine;

/**
 * One `excluded_interval` row in session elapsed time. Adjacent spans with the same reason are
 * merged, so each row keeps a distinct start (the table's primary key).
 */
public record ExcludedSpan(long startMs, long endMs, Reason reason) {
    /** `excluded_interval.exclusion_reason` values (schema V2.2). */
    public enum Reason {
        PAUSE,
        ABSENCE,
        UNMEASURABLE,
        MISSING
    }
}
