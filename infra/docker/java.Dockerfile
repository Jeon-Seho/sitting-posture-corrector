FROM maven:3.9.16-eclipse-temurin-21 AS build
WORKDIR /source
COPY backend ./backend
RUN mvn -B -f backend/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 posegood \
    && useradd --uid 10001 --gid posegood --no-create-home posegood
WORKDIR /app
USER posegood
ENV SERVER_ADDRESS=0.0.0.0

FROM runtime AS api
COPY --from=build /source/backend/api/target/session-api-0.1.0-SNAPSHOT.jar /app/service.jar
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "/app/service.jar"]

FROM runtime AS cep
COPY --from=build /source/backend/cep/target/cep-service-0.1.0-SNAPSHOT.jar /app/service.jar
EXPOSE 8091
ENTRYPOINT ["java", "-jar", "/app/service.jar"]
