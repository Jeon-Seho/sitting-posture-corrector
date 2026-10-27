package org.posegood.api.account;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

import java.time.Clock;
import java.time.Duration;

/**
 * 보안 설정: 비밀번호 해시(BCrypt), 공개 경로, CSRF, 401·403 JSON 응답, 로그인 고정 만료({@link LoginLifetime}).
 *
 * 로그인 세션은 DB(`SPRING_SESSION`)에 둔다. {@code /v2/realtime}은 HTTP 단계에서 열어 둔다.
 * 로그인이 없으면 연결 실패 대신 hello 응답 {@code closed: unauthorized}로 알려 앱이 계속 재시도하지 않게 한다.
 */
@Configuration
public class SecurityConfiguration {
    @Bean
    PasswordEncoder passwords() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    AuthenticationManager authentication(AccountAuthenticationProvider provider) {
        return new ProviderManager(provider);
    }

    @Bean
    HttpSessionSecurityContextRepository contexts() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    HttpSessionCsrfTokenRepository csrfTokens() {
        var repository = new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-TOKEN");
        return repository;
    }

    /** 요청 보안 규칙: 공개 경로 외에는 로그인 필요, 상태를 바꾸는 요청은 CSRF 검사. */
    @Bean
    SecurityFilterChain accounts(
            HttpSecurity http,
            HttpSessionSecurityContextRepository contexts,
            HttpSessionCsrfTokenRepository tokens,
            @Value("${posegood.login-lifetime}") Duration loginLifetime)
            throws Exception {
        return http.securityContext(
                        context -> context.securityContextRepository(contexts).requireExplicitSave(true))
                .csrf(
                        csrf ->
                                csrf.csrfTokenRepository(tokens)
                                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                "/health",
                                                "/v2/auth/csrf",
                                                "/v2/auth/register",
                                                "/v2/auth/login",
                                                "/v2/realtime")
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                                (request, response, error) ->
                                                        json(
                                                                response,
                                                                401,
                                                                "UNAUTHENTICATED",
                                                                "authentication required"))
                                        .accessDeniedHandler(
                                                (request, response, error) ->
                                                        json(
                                                                response,
                                                                403,
                                                                "ACCESS_DENIED",
                                                                "CSRF or access denied")))
                .addFilterBefore(new LoginLifetime(loginLifetime, Clock.systemUTC()), AnonymousAuthenticationFilter.class)
                .addFilterAfter(new IdentityGuard(), AnonymousAuthenticationFilter.class)
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .build();
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
