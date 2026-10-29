package org.posegood.api.account;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;
import java.util.Set;

/**
 * 보안 설정(ADR 0031): 비밀번호 해시(BCrypt), 공개 경로, access 토큰(JWT, {@code Authorization: Bearer}) 확인,
 * 401·403 JSON 응답.
 *
 * 서버는 로그인 상태를 저장하지 않는다(세션·CSRF 없음). 로그인 유지는 refresh 토큰 쿠키로 {@code /v2/auth/refresh}에서만
 * 한다({@link AuthTokens}). {@code /v2/realtime}은 HTTP 단계에서 열어 두고 hello의 {@code access_token}으로 확인한다.
 * 로그인이 없으면 연결 실패 대신 {@code closed: unauthorized}로 알려 앱이 계속 재시도하지 않게 한다.
 * 다른 출처 화면(Vercel {@code app.<도메인>})은 {@code posegood.cors.allowed-origins}에 적힌 출처만 부를 수 있다.
 */
@Configuration
public class SecurityConfiguration {
    /** 로그인 없이 부르는 경로. 여기에는 access 토큰이 붙어 와도 보지 않는다(만료된 토큰으로 로그인·갱신을 막지 않게). */
    static final Set<String> PUBLIC =
            Set.of(
                    "/health",
                    "/v2/auth/register",
                    "/v2/auth/login",
                    "/v2/auth/refresh",
                    "/v2/auth/logout",
                    "/v2/realtime");

    @Bean
    PasswordEncoder passwords() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    AuthenticationManager authentication(AccountAuthenticationProvider provider) {
        return new ProviderManager(provider);
    }

    /** 요청 보안 규칙: 공개 경로 외에는 유효한 access 토큰이 필요하다. */
    @Bean
    SecurityFilterChain accounts(
            HttpSecurity http,
            AuthTokens tokens,
            @Value("${posegood.cors.allowed-origins:}") List<String> allowedOrigins)
            throws Exception {
        AuthenticationEntryPoint unauthenticated =
                (request, response, error) -> json(response, 401, "UNAUTHENTICATED", "authentication required");
        return http.cors(cors -> cors.configurationSource(corsSource(allowedOrigins)))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(
                        auth -> auth.requestMatchers(PUBLIC.toArray(String[]::new)).permitAll().anyRequest().authenticated())
                .oauth2ResourceServer(
                        resource ->
                                resource.bearerTokenResolver(bearerTokens())
                                        .authenticationEntryPoint(unauthenticated)
                                        .jwt(jwt -> jwt.decoder(tokens.decoder())
                                                .jwtAuthenticationConverter(AuthTokens::authentication)))
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(unauthenticated)
                                        .accessDeniedHandler(
                                                (request, response, error) ->
                                                        json(response, 403, "ACCESS_DENIED", "access denied")))
                .addFilterAfter(new IdentityGuard(), AnonymousAuthenticationFilter.class)
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .build();
    }

    /**
     * 다른 출처 화면의 요청 허용. 확인 요청(OPTIONS)은 인증 전에 여기서 답한다. refresh 쿠키를 실어야 해서
     * credentials를 허용하고, 그래서 출처는 {@code *} 없이 실제 주소만 받는다. 허용 출처가 없으면 아무 경로에도
     * 설정을 두지 않는다 — 같은 출처 요청은 nginx가 Host의 포트를 떼도 지금처럼 통과한다.
     */
    static CorsConfigurationSource corsSource(List<String> origins) {
        var source = new UrlBasedCorsConfigurationSource();
        var allowed = origins.stream().map(String::trim).filter(origin -> !origin.isEmpty()).toList();
        if (allowed.isEmpty()) return source;
        if (allowed.contains("*")) throw new IllegalStateException("posegood.cors.allowed-origins must list origins, not *");
        var config = new CorsConfiguration();
        config.setAllowedOrigins(allowed);
        config.setAllowCredentials(true);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-PoseGood-User-Id"));
        config.setMaxAge(3600L);
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    private static BearerTokenResolver bearerTokens() {
        var header = new DefaultBearerTokenResolver();
        return request -> PUBLIC.contains(request.getRequestURI()) ? null : header.resolve(request);
    }

    private static void json(
            jakarta.servlet.http.HttpServletResponse response, int status, String code, String message)
            throws java.io.IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter()
                .write(
                        "{\"error\":\"" + message + "\",\"code\":\"" + code + "\",\"message\":\""
                                + message + "\"}");
    }
}
