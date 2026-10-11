package org.posegood.api.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.posegood.api.contract.Policy;
import org.posegood.api.contract.SessionView;
import org.posegood.api.contract.SessionView.DecisionEvent;
import org.posegood.api.policy.ThresholdPolicyRepository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Rebuilds a closed session's view and RecordItem from its rows (schema V2.1 dropped
 * `client_record`). The tables keep the decision times, so events, exclusions and statistics follow
 * the engine's definitions. They do not keep the deviation type (T-36 `collapse_type` is on hold),
 * the accepted input count or good time below 0.1 s: those become "unspecified", -1 and the
 * stored `good_sec`.
 */
final class RecordRebuild {
    /** Elapsed session milliseconds of one `collapse_event` row and its `correction_alert` rows. */
    record Episode(long onsetMs, long confirmedMs, Long endedMs, String endReason, List<Long> alertMs) {}

    /** One `excluded_interval` row in elapsed session milliseconds. */
    record Span(long startMs, long endMs, String reason) {}

    private RecordRebuild() {}

    static SessionView view(
            UUID id, Policy policy, long totalMs, long goodMs, List<Episode> episodes, List<Span> spans) {
        long rest = 0, away = 0, unknown = 0, missing = 0;
        for (var span : spans) {
            long duration = Math.max(0, Math.min(span.endMs(), totalMs) - span.startMs());
            switch (span.reason()) {
                case "PAUSE" -> rest += duration;
                case "ABSENCE" -> away += duration;
                case "UNMEASURABLE" -> unknown += duration;
                default -> missing += duration;
            }
        }
        long valid = Math.max(0, totalMs - rest - away - unknown - missing);
        long normal = Math.min(valid, goodMs);

        var events = new ArrayList<DecisionEvent>();
        long eventId = 0, alerts = 0, intervals = 0, intervalSum = 0, recoveries = 0, recoverySum = 0;
        Long previousOnsetValid = null;
        for (var episode : episodes) {
            long onset = clamp(episode.onsetMs(), totalMs);
            long confirmed = clamp(episode.confirmedMs(), totalMs);
            long onsetValid = Math.min(valid, Math.max(0, onset - excludedBefore(spans, onset)));
            events.add(event(id, ++eventId, "collapse_confirmed", confirmed, onset, onsetValid, null));
            alerts++;
            for (int attempt = 1; attempt < episode.alertMs().size(); attempt++) {
                long reminder = clamp(episode.alertMs().get(attempt), totalMs);
                events.add(event(id, ++eventId, "reminder", reminder, onset, onsetValid, null));
                alerts++;
            }
            if (previousOnsetValid != null) {
                intervals++;
                intervalSum += onsetValid - previousOnsetValid;
            }
            previousOnsetValid = onsetValid;
            long end = episode.endedMs() == null ? totalMs : clamp(episode.endedMs(), totalMs);
            if ("RECOVERED".equals(episode.endReason())) {
                recoveries++;
                recoverySum += end - confirmed;
                events.add(event(id, ++eventId, "recovery_confirmed", end, onset, onsetValid, null));
            } else {
                String reason = "EXCLUDED".equals(episode.endReason()) ? interruption(spans, end) : "ended";
                events.add(event(id, ++eventId, "interrupted", end, onset, onsetValid, reason));
            }
        }
        events.add(
                new DecisionEvent("1.0", id, ++eventId, "session_ended", totalMs, totalMs, valid, "none", "ended"));
        long collapses = episodes.size();
        var summary =
                new SessionView.Summary(
                        totalMs,
                        valid,
                        normal,
                        valid - normal,
                        rest,
                        away,
                        unknown,
                        missing,
                        collapses,
                        alerts,
                        intervals,
                        valid == 0 ? null : (double) normal / valid,
                        valid == 0 ? null : collapses * 3_600_000.0 / valid,
                        intervals == 0 ? null : (double) intervalSum / intervals,
                        recoveries == 0 ? null : (double) recoverySum / recoveries);
        return new SessionView("1.0", id, policy, SessionView.TIMER_POLICY, true, -1, summary, List.copyOf(events));
    }

    /**
     * The app's RecordItem. A USER_STOP session is confirmed; DISCONNECTED keeps its view but is
     * not confirmed; ERROR (decision state lost) has no view and zero totals.
     */
    static ObjectNode record(
            String id,
            String startedAt,
            String endedAt,
            ThresholdPolicyRepository.Values rules,
            UUID calibration,
            String endReason,
            SessionView view,
            String modelVersion,
            JsonNode viewJson) {
        boolean confirmed = "USER_STOP".equals(endReason);
        var factory = JsonNodeFactory.instance;
        ObjectNode record = factory.objectNode();
        record.put("id", id);
        record.put("startedAt", startedAt);
        record.put("endedAt", endedAt);
        record.put("mode", "camera");
        record.put("valid", view == null ? 0 : view.summary().validMs() / 1000.0);
        record.put("good", view == null ? 0 : view.summary().normalMs() / 1000.0);
        record.put("total", view == null ? 0 : view.summary().totalMs() / 1000.0);
        record.set("events", view == null ? factory.arrayNode() : RecordProjection.events(view, confirmed));
        record.set("rules", rules(rules));
        ObjectNode server = record.putObject("server");
        server.put("baselineId", calibration.toString());
        server.put("modelVersion", view == null || view.summary().totalMs() == 0 ? "unmeasured" : modelVersion);
        server.put("confirmed", confirmed);
        server.set("view", view == null ? factory.nullNode() : viewJson);
        return record;
    }

    static ObjectNode rules(ThresholdPolicyRepository.Values policy) {
        ObjectNode rules = JsonNodeFactory.instance.objectNode();
        rules.set("holdSeconds", number(policy.holdSeconds()));
        rules.set("recoverSeconds", number(policy.recoverSeconds()));
        rules.put("realertSeconds", policy.realertSeconds());
        rules.set("threshold", number(policy.threshold()));
        return rules;
    }

    /** Plain JSON numbers (3, 2.5, 0.62) rather than DECIMAL scale or exponent forms. */
    static JsonNode number(BigDecimal value) {
        var plain = value.stripTrailingZeros();
        return plain.scale() <= 0 ? IntNode.valueOf(plain.intValueExact()) : DoubleNode.valueOf(plain.doubleValue());
    }

    /** Excluded time before {@code at}: the onset's position on the valid-time axis is the rest. */
    private static long excludedBefore(List<Span> spans, long at) {
        long sum = 0;
        for (var span : spans) if (span.startMs() < at) sum += Math.min(span.endMs(), at) - span.startMs();
        return sum;
    }

    /**
     * The engine interrupts an episode where the exclusion that caused it starts. Without such a
     * span the cause was a sequence hole.
     */
    private static String interruption(List<Span> spans, long at) {
        for (var span : spans)
            if (span.startMs() == at)
                return switch (span.reason()) {
                    case "PAUSE" -> "rest";
                    case "ABSENCE" -> "away";
                    case "UNMEASURABLE" -> "unmeasurable";
                    default -> "missing";
                };
        return "missing_sequence";
    }

    private static long clamp(long value, long totalMs) {
        return Math.max(0, Math.min(value, totalMs));
    }

    private static DecisionEvent event(
            UUID id, long eventId, String kind, long at, long onset, long onsetValid, String reason) {
        return new DecisionEvent("1.0", id, eventId, kind, at, onset, onsetValid, "unspecified", reason);
    }
}
