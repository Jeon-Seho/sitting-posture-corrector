package com.posture.api.posture.realtime;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * (D-21) <b>시험용 입구</b> — 계약 v1 {@code posture.features.v1} 메시지를 HTTP로 받아 Kafka에 넣는다.
 *
 * <p>최종 입구는 팀 입구 API·게이트웨이(WebSocket)다. 이 엔드포인트는 그 전에 서버 쪽 경로
 * (features.v1 → 추론 → inference.v1 → 판정)를 재생 도구·통합 테스트로 시험하기 위한 것이다.
 * {@code REALTIME_TEST_ENTRY_ENABLED=false}(환경변수)로 끌 수 있다.
 *
 * <p>본문은 메시지 1개(객체) 또는 여러 개(배열, 최대 200개). 배열은 <b>전부 검사를 통과해야</b>
 * 순서대로 발행한다(일부만 들어가 순번이 비는 일을 막음).
 */
@RestController
@RequestMapping("/api/v1/realtime")
public class RealtimeTestEntryController {

    static final int MAX_BATCH = 200;

    private final RealtimeFeaturesPublisher publisher;
    private final JsonMapper jsonMapper;
    private final boolean enabled;

    public RealtimeTestEntryController(
            RealtimeFeaturesPublisher publisher,
            JsonMapper jsonMapper,
            @Value("${app.realtime.test-entry.enabled:true}") boolean enabled) {
        this.publisher = publisher;
        this.jsonMapper = jsonMapper;
        this.enabled = enabled;
    }

    @PostMapping("/features")
    public ResponseEntity<Map<String, Object>> submit(@RequestBody String rawBody) {
        if (!enabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        Object parsed;
        try {
            parsed = jsonMapper.readValue(rawBody, Object.class);
        } catch (Exception exc) {
            return badRequest(List.of("JSON 파싱 실패: " + exc.getMessage()));
        }
        List<Object> items = parsed instanceof List<?> l ? new ArrayList<>(l) : List.of(parsed);
        if (items.isEmpty() || items.size() > MAX_BATCH) {
            return badRequest(List.of("메시지는 1~" + MAX_BATCH + "개여야 함"));
        }

        List<String> errors = new ArrayList<>();
        List<Map<String, Object>> messages = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> m)) {
                errors.add("[" + i + "] 객체가 아님");
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> msg = (Map<String, Object>) m;
            for (String e : RealtimeEnvelopeValidator.validateFeaturesMessage(msg)) {
                errors.add("[" + i + "] " + e);
            }
            messages.add(msg);
        }
        if (!errors.isEmpty()) {
            return badRequest(errors);
        }

        for (Map<String, Object> msg : messages) {
            // 받은 메시지를 바꾸지 않고 그대로 직렬화해 넣는다(필드 순서만 다를 수 있음)
            publisher.publish((String) msg.get("session_id"), jsonMapper.writeValueAsString(msg));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("accepted", messages.size());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(body);
    }

    private static ResponseEntity<Map<String, Object>> badRequest(List<String> errors) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", 400);
        body.put("error", "Bad Request");
        body.put("errors", errors.size() > 50 ? errors.subList(0, 50) : errors);
        return ResponseEntity.badRequest().body(body);
    }
}
