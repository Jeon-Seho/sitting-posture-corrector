# Spring Boot 서비스 이미지 (backend/ Gradle 멀티 프로젝트).
#   target api        — 입출구 서버(backend/api, session-api JAR, 8090)
#   target processing — 처리 서비스(backend/processing, 옛 api-server, 8080) (D-52)
# 빌드 컨텍스트는 저장소 루트다(루트 .dockerignore 적용).
# 2026-10-15: 백엔드가 Gradle로 바뀐 뒤(a716135)에도 Maven(backend/pom.xml)을 부르던 빌드 단계를 Gradle Wrapper로 바꿨다.

FROM eclipse-temurin:17-jdk-jammy AS deps
WORKDIR /source/backend
# Wrapper·빌드 스크립트만 먼저 복사 — 소스만 바뀌면 Gradle 배포판·의존성 레이어를 다시 받지 않는다.
COPY backend/gradlew backend/settings.gradle ./
COPY backend/gradle ./gradle
COPY backend/api/build.gradle ./api/
COPY backend/processing/build.gradle ./processing/
RUN chmod +x gradlew \
    && ./gradlew --no-daemon --console=plain :api:dependencies :processing:dependencies > /dev/null

FROM deps AS build-api
COPY backend/api/src ./api/src
RUN ./gradlew --no-daemon --console=plain :api:bootJar

FROM deps AS build-processing
COPY backend/processing/src ./processing/src
RUN ./gradlew --no-daemon --console=plain :processing:bootJar

FROM eclipse-temurin:17-jre-jammy AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 posegood \
    && useradd --uid 10001 --gid posegood --no-create-home posegood
WORKDIR /app
USER posegood
ENV SERVER_ADDRESS=0.0.0.0

FROM runtime AS processing
COPY --from=build-processing /source/backend/processing/build/libs/api-server.jar /app/service.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/service.jar"]

# 마지막 target이 기본값 — 팀 compose.yaml·tools/deploy_images.py는 target api를 명시한다.
FROM runtime AS api
COPY --from=build-api /source/backend/api/build/libs/session-api-0.1.0-SNAPSHOT.jar /app/service.jar
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "/app/service.jar"]
