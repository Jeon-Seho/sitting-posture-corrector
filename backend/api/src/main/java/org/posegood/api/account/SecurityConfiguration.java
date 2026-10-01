package org.posegood.api.account;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
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

@Configuration
public class SecurityConfiguration {
    @Bean
    @Profile("!persistent")
    org.springframework.security.core.userdetails.UserDetailsService noDevelopmentAccounts() {
        return username -> {
            throw new org.springframework.security.core.userdetails.UsernameNotFoundException(
                    "server accounts require persistent profile");
        };
    }

    @Bean
    @Profile("!persistent")
    SecurityFilterChain development(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .build();
    }

    @Bean
    @Profile("persistent")
    PasswordEncoder passwords() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    @Profile("persistent")
    AuthenticationManager authentication(AccountAuthenticationProvider provider) {
        return new ProviderManager(provider);
    }

    @Bean
    @Profile("persistent")
    HttpSessionSecurityContextRepository contexts() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    @Profile("persistent")
    HttpSessionCsrfTokenRepository csrfTokens() {
        var repository = new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-TOKEN");
        return repository;
    }

    @Bean
    @Profile("persistent")
    SecurityFilterChain accounts(
            HttpSecurity http,
            HttpSessionSecurityContextRepository contexts,
            HttpSessionCsrfTokenRepository tokens)
            throws Exception {
        return http.securityContext(
                        context ->
                                context.securityContextRepository(contexts)
                                        .requireExplicitSave(true))
                .csrf(
                        csrf ->
                                csrf.csrfTokenRepository(tokens)
                                        .csrfTokenRequestHandler(
                                                new CsrfTokenRequestAttributeHandler()))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                "/health",
                                                "/v1/auth/csrf",
                                                "/v1/auth/register",
                                                "/v1/auth/login")
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                                (request, response, error) -> {
                                                    response.setStatus(401);
                                                    response.setContentType("application/json");
                                                    response.getWriter()
                                                            .write(
                                                                    "{\"error\":\"authentication"
                                                                        + " required\",\"code\":\"UNAUTHENTICATED\",\"message\":\"authentication"
                                                                        + " required\"}");
                                                })
                                        .accessDeniedHandler(
                                                (request, response, error) -> {
                                                    response.setStatus(403);
                                                    response.setContentType("application/json");
                                                    response.getWriter()
                                                            .write(
                                                                    "{\"error\":\"CSRF or access"
                                                                        + " denied\",\"code\":\"ACCESS_DENIED\",\"message\":\"CSRF"
                                                                        + " or access denied\"}");
                                                }))
                .addFilterAfter(new IdentityGuard(), AnonymousAuthenticationFilter.class)
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .build();
    }
}
