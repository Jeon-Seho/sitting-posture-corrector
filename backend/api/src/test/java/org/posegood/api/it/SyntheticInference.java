package org.posegood.api.it;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 통합 시험용 가짜 추론 서버(FastAPI와 같은 참조 규칙).
 *
 * FastAPI {@code POST /v2/infer} 대신 쓰는 loopback 서버. 규칙은 model/inference/service.py와 같다.
 * {@link #fail}을 켜면 다음 호출부터 503으로 답한다.
 */
public final class SyntheticInference implements AutoCloseable {
    private final HttpServer server;
    private final ObjectMapper mapper = new ObjectMapper();
    public final AtomicBoolean fail = new AtomicBoolean();

    public SyntheticInference() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/v2/infer",
                exchange -> {
                    byte[] body;
                    int status = 200;
                    if (fail.get()) {
                        status = 503;
                        body = "{}".getBytes(StandardCharsets.UTF_8);
                    } else {
                        body = mapper.writeValueAsBytes(observe(mapper.readTree(exchange.getRequestBody())));
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
                "running".equals(request.get("phase").asText())
                        && "good".equals(request.get("measurement_quality").asText())
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
        result.put("phase", request.get("phase").asText());
        result.put("valid", valid);
        result.put("collapse_probability", score);
        result.put("deviation_type", type);
        result.put("model_version", "reference-feature-rule-v1");
        return result;
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
