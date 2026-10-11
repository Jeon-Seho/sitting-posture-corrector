package org.posegood.api.account;

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

/**
 * DB-backed login sessions (`SPRING_SESSION`), CSRF on every state change, JSON 401/403 bodies.
 * {@code /v1/realtime} is permitted at the HTTP layer: its hello message reports a missing login as
 * {@code closed: unauthorized} instead of a failed upgrade that the app would keep retrying.
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

    @Bean
    SecurityFilterChain accounts(
            HttpSecurity http,
            HttpSessionSecurityContextRepository contexts,
            HttpSessionCsrfTokenRepository tokens)
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
                                                "/v1/auth/csrf",
                                                "/v1/auth/register",
                                                "/v1/auth/login",
                                                "/v1/auth/withdrawal/cancel",
                                                "/v1/realtime")
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
