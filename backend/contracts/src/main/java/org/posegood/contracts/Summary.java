package org.posegood.contracts;
public record Summary(long totalMs, long validMs, long normalMs, long deviationMs,
                      long restMs, long awayMs, long unknownMs, long missingMs,
                      long collapseCount, long alertCount, Double keepRate, Double eventsPerHour,
                      long intervalCount, Double meanIntervalMs, Double meanRecoveryMs) {}
