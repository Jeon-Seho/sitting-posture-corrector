package org.posegood.api.it;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import org.posegood.api.contract.FrameInterval;
import org.posegood.api.contract.SessionRequests;
import org.posegood.api.session.FrameFeatures;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 통합 시험용 가짜 추론 서버(FastAPI와 같은 참조 규칙).
 *
 * FastAPI {@code POST /v2/infer}·{@code POST /v3/infer}(프레임 묶음, 계획 0084) 대신 쓰는 loopback 서버. 규칙은
 * model/inference/service.py·frames.py와 같고, 프레임 특징은 같은 규칙의 Java 구현({@link FrameFeatures#frame})으로 낸다.
 * {@link #fail}을 켜면 다음 호출부터 503으로 답한다.
 */
public final class SyntheticInference implements AutoCloseable {
    private final HttpServer server;
    private final ObjectMapper mapper = new ObjectMapper();
    public final AtomicBoolean fail = new AtomicBoolean();

    public SyntheticInference() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        for (var path : List.of("/v2/infer", "/v3/infer"))
            server.createContext(
                    path,
                    exchange -> {
                        byte[] body;
                        int status = 200;
                        if (fail.get()) {
                            status = 503;
                            body = "{}".getBytes(StandardCharsets.UTF_8);
                        } else {
                            var request = mapper.readTree(exchange.getRequestBody());
                            body = mapper.writeValueAsBytes(path.equals("/v3/infer") ? frames(request) : observe(request));
                        }
                        exchange.getResponseHeaders().add("Content-Type", "application/json");
                        exchange.sendResponseHeaders(status, body.length);
                        exchange.getResponseBody().write(body);
                        exchange.close();
                    });
        server.start();
    }

    public String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static Object observe(JsonNode request) {
        var features = request.get("features");
        boolean valid =
                "running".equals(request.get("phase").asString())
                        && "good".equals(request.get("measurement_quality").asString())
                        && !features.isNull()
                        && features.get("current_quality").asDouble() >= 0.65
                        && features.get("baseline_quality").asDouble() >= 0.65;
        double score = 0;
        String type = "none";
        if (valid) {
            double head = Math.abs(features.get("head_gap_delta").asDouble()) / 0.22;
            double lateral = Math.abs(features.get("lateral_offset_delta").asDouble()) / 0.20;
            double shoulder = Math.abs(features.get("shoulder_tilt_delta").asDouble()) / 0.03;
            score = Math.min(1.0, Math.max(head, Math.max(lateral, shoulder)) * 0.7);
            if (score > 0)
                type =
                        lateral > head && lateral > shoulder
                                ? features.get("lateral_offset_delta").asDouble() > 0 ? "left_lean" : "right_lean"
                                : "unspecified";
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("schema_version", "2.0");
        result.put("sequence", request.get("sequence").asLong());
        result.put("start_ms", request.get("start_ms").asLong());
        result.put("end_ms", request.get("end_ms").asLong());
        result.put("phase", request.get("phase").asString());
        result.put("valid", valid);
        result.put("collapse_probability", score);
        result.put("deviation_type", type);
        result.put("model_version", "reference-feature-rule-v1");
        return result;
    }

    /** v3: 프레임마다 판정한다(평균하지 않음). */
    private static Object frames(JsonNode request) {
        var points = new SessionRequests.Point[9];
        for (int i = 0; i < 9; i++) {
            var joint = request.get("baseline").get(i);
            points[i] = new SessionRequests.Point(joint.get(0).asDouble(), joint.get(1).asDouble());
        }
        var baseline = FrameFeatures.baseline(new SessionRequests.Landmarks(
                points[0], points[1], points[2], points[3], points[4], points[5], points[6], points[7], points[8]));
        var results = new ArrayList<Object>();
        for (var node : request.get("frames")) {
            List<List<Double>> p = null;
            if (!node.get("p").isNull()) {
                p = new ArrayList<>();
                for (var joint : node.get("p"))
                    p.add(List.of(joint.get(0).asDouble(), joint.get(1).asDouble(), joint.get(2).asDouble()));
            }
            var frame = new FrameInterval.Frame(node.get("t_ms").asLong(), p, node.has("valid") ? false : null);
            var judged = FrameFeatures.frame(frame, baseline);
            var result = new LinkedHashMap<String, Object>();
            result.put("t_ms", frame.tMs());
            double score = 0;
            String type = "none";
            if (judged.deltas() != null) {
                var d = judged.deltas();
                double head = Math.abs(d.headGapDelta()) / 0.22;
                double lateral = Math.abs(d.lateralOffsetDelta()) / 0.20;
                double shoulder = Math.abs(d.shoulderTiltDelta()) / 0.03;
                score = Math.min(1.0, Math.max(head, Math.max(lateral, shoulder)) * 0.7);
                if (score > 0)
                    type = lateral > head && lateral > shoulder
                            ? d.lateralOffsetDelta() > 0 ? "left_lean" : "right_lean"
                            : "unspecified";
            }
            result.put("valid", judged.deltas() != null);
            result.put("collapse_probability", score);
            result.put("deviation_type", type);
            result.put("invalid_reason", judged.invalidReason());
            results.add(result);
        }
        var response = new LinkedHashMap<String, Object>();
        response.put("schema_version", "3.0");
        response.put("model_version", "reference-feature-rule-v1");
        response.put("frames", results);
        return response;
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
