package org.posegood.cep.esper;

import com.espertech.esper.common.client.EPCompiled;
import com.espertech.esper.common.client.configuration.Configuration;
import com.espertech.esper.compiler.client.CompilerArguments;
import com.espertech.esper.compiler.client.EPCompilerProvider;
import com.espertech.esper.runtime.client.EPDeployException;
import com.espertech.esper.runtime.client.EPRuntime;
import com.espertech.esper.runtime.client.EPRuntimeProvider;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** Owns Esper configuration, EPL compilation, deployment, and synchronous event dispatch. */
public final class EsperDecisionRuntime implements AutoCloseable {
    private static final EPCompiled COMPILED = compile();

    private final EPRuntime runtime;

    /** Prepare compilation, deployment and first dispatch before HTTP readiness opens. */
    public static void prepare() {
        try (var prepared = new EsperDecisionRuntime(UUID.randomUUID(), kind -> {})) {
            // This frame has no active/candidate episode, so it cannot produce a decision.
            // The temporary runtime never enters the session registry or consumes its limit.
            prepared.evaluate(new Frame(false, false, 0, 0, 0, 0, 0, 0));
        }
    }

    public EsperDecisionRuntime(UUID sessionId, Consumer<String> decisionListener) {
        runtime =
                EPRuntimeProvider.getRuntime(
                        "session-" + sessionId + "-" + UUID.randomUUID(), configuration());
        try {
            var deployment = runtime.getDeploymentService().deploy(COMPILED);
            for (var statement : deployment.getStatements()) {
                statement.addListener(
                        (newEvents, oldEvents, source, context) -> {
                            if (newEvents != null) {
                                for (var event : newEvents) {
                                    decisionListener.accept((String) event.get("kind"));
                                }
                            }
                        });
            }
        } catch (EPDeployException error) {
            runtime.destroy();
            throw new IllegalStateException("cannot deploy CEP rules", error);
        }
    }

    public void evaluate(Frame frame) {
        var fields = new HashMap<String, Object>();
        fields.put("candidate", frame.candidate());
        fields.put("active", frame.active());
        fields.put("holdMs", frame.holdMs());
        fields.put("holdThresholdMs", frame.holdThresholdMs());
        fields.put("recoveryMs", frame.recoveryMs());
        fields.put("recoveryThresholdMs", frame.recoveryThresholdMs());
        fields.put("sinceAlertMs", frame.sinceAlertMs());
        fields.put("reminderThresholdMs", frame.reminderThresholdMs());
        runtime.getEventService().sendEventMap(fields, "CepFrame");
    }

    private static Configuration configuration() {
        var configuration = new Configuration();
        configuration.getRuntime().getThreading().setInternalTimerEnabled(false);
        var fields = new HashMap<String, Object>();
        fields.put("candidate", Boolean.class);
        fields.put("active", Boolean.class);
        for (var name :
                List.of(
                        "holdMs",
                        "holdThresholdMs",
                        "recoveryMs",
                        "recoveryThresholdMs",
                        "sinceAlertMs",
                        "reminderThresholdMs")) {
            fields.put(name, Long.class);
        }
        configuration.getCommon().addEventType("CepFrame", fields);
        return configuration;
    }

    private static EPCompiled compile() {
        try (var source = EsperDecisionRuntime.class.getResourceAsStream("/rules/posture.epl")) {
            if (source == null) {
                throw new IllegalStateException("missing EPL");
            }
            return EPCompilerProvider.getCompiler()
                    .compile(
                            new String(source.readAllBytes(), StandardCharsets.UTF_8),
                            new CompilerArguments(configuration()));
        } catch (Exception error) {
            throw new IllegalStateException("cannot compile CEP rules", error);
        }
    }

    @Override
    public void close() {
        runtime.destroy();
    }

    public record Frame(
            boolean candidate,
            boolean active,
            long holdMs,
            long holdThresholdMs,
            long recoveryMs,
            long recoveryThresholdMs,
            long sinceAlertMs,
            long reminderThresholdMs) {}
}
