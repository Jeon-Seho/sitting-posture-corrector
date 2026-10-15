package org.posegood.api.common;

import tools.jackson.core.StreamReadFeature;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * application.properties로 켤 수 없는 JSON 읽기 규칙.
 *
 * 같은 키가 두 번 나오는 요청은 거부한다(400). Spring Boot 4·Jackson 3에서 이 기능은 StreamReadFeature로
 * 옮겨졌고, 예전 설정 {@code spring.jackson.parser.strict-duplicate-detection}은 더 이상 적용되지 않는다.
 */
@Configuration
public class JsonConfiguration {
    @Bean
    JsonMapperBuilderCustomizer strictDuplicateDetection() {
        return builder -> builder.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION);
    }
}
