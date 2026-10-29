package org.posegood.api.account;

import com.nimbusds.jose.jwk.source.ImmutableSecret;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/**
 * 로그인 토큰(ADR 0031): 짧은 access 토큰(JWT HS256, 30분, 저장 안 함)과 로그인 유지 토큰(refresh, 14일).
 *
 * <p>refresh 토큰은 무작위 32바이트이고, DB({@code refresh_token})에는 SHA-256만 둔다. 쓸 때마다 새 토큰으로 바꾼다.
 * 바꾼 뒤 유예(30초) 안에 옛 토큰이 다시 오면(여러 탭이 동시에 갱신) 한 번 더 새 토큰을 주고, 그 뒤 재사용은 탈취로 보고
 * 그 사용자의 토큰을 모두 철회한다. access 토큰은 철회하지 않는다 — 비밀번호 변경·탈퇴 뒤에도 남은 시간(최대 30분)은
 * 유효하고, 열린 실시간 연결은 그때 바로 닫힌다({@code LoginsRemoved}).
 */
@Component
public class AuthTokens {
    /** refresh 토큰을 담는 HttpOnly 쿠키 이름. */
    public static final String REFRESH_COOKIE = "posegood_refresh";

    private static final Logger log = LoggerFactory.getLogger(AuthTokens.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RefreshTokenRepository refreshTokens;
    private final AccountService accounts;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;
    private final Duration accessLifetime;
    private final Duration refreshLifetime;
    private final Duration refreshGrace;
    private final Clock clock;

    @Autowired
    public AuthTokens(
            RefreshTokenRepository refreshTokens,
            AccountService accounts,
            @Value("${posegood.auth.jwt-secret}") String secret,
            @Value("${posegood.auth.access-lifetime}") Duration accessLifetime,
            @Value("${posegood.auth.refresh-lifetime}") Duration refreshLifetime,
            @Value("${posegood.auth.refresh-grace}") Duration refreshGrace) {
        this(refreshTokens, accounts, key(secret), accessLifetime, refreshLifetime, refreshGrace, Clock.systemUTC());
    }

    AuthTokens(
            RefreshTokenRepository refreshTokens,
            AccountService accounts,
            SecretKey key,
            Duration accessLifetime,
            Duration refreshLifetime,
            Duration refreshGrace,
            Clock clock) {
        this.refreshTokens = refreshTokens;
        this.accounts = accounts;
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        this.accessLifetime = accessLifetime;
        this.refreshLifetime = refreshLifetime;
        this.refreshGrace = refreshGrace;
        this.clock = clock;
    }

    /** 발급 결과. {@code expiresIn}은 access 토큰의 남은 초다(앱은 만료 전에 미리 갱신한다). */
    public record Issued(long owner, String accessToken, long expiresIn, String refreshToken) {}

    /** 로그인·가입: access와 새 refresh 토큰을 발급한다. */
    public Issued signIn(long owner) {
        return issue(owner, clock.instant());
    }

    /**
     * refresh 토큰으로 새 access·refresh 토큰을 받는다. 없거나 만료·철회·재사용이면 401 {@code UNAUTHENTICATED}.
     *
     * 탈퇴한(CLOSED) 계정도 401이다.
     */
    public Issued refresh(String refreshToken) {
        Instant now = clock.instant();
        var stored = refreshToken == null || refreshToken.isBlank() ? null : refreshTokens.find(hash(refreshToken));
        if (stored == null || stored.revokedAt() != null || !now.isBefore(stored.expiresAt())) throw expired();
        if (stored.rotatedAt() != null && now.isAfter(stored.rotatedAt().plus(refreshGrace))) {
            // 이미 바꾼 토큰을 유예 뒤에 다시 씀: 탈취로 보고 그 사용자의 로그인을 모두 끊는다.
            refreshTokens.revokeAll(stored.owner(), now);
            log.warn("refresh token reused after rotation; all logins revoked for one account");
            throw expired();
        }
        accounts.requireActive(stored.owner());
        refreshTokens.markRotated(stored.id(), now);
        return issue(stored.owner(), now);
    }

    /** 로그아웃: 이 기기의 refresh 토큰을 철회한다. 없거나 모르는 토큰이면 아무것도 하지 않는다. */
    public void signOut(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return;
        var stored = refreshTokens.find(hash(refreshToken));
        if (stored != null) refreshTokens.revoke(stored.id(), clock.instant());
    }

    /** access 토큰 확인(실시간 hello). 틀리거나 만료면 401 {@code UNAUTHENTICATED}. */
    public UsernamePasswordAuthenticationToken authenticate(String accessToken) {
        if (accessToken == null || accessToken.isBlank()) throw unauthenticated();
        try {
            return authentication(decoder.decode(accessToken));
        } catch (JwtException invalid) {
            throw unauthenticated();
        }
    }

    /** 확인된 JWT → 사용자 인증 정보(사용자 ID만 담음). HTTP 요청 필터도 이것을 쓴다. */
    static UsernamePasswordAuthenticationToken authentication(Jwt jwt) {
        long owner;
        try {
            owner = Long.parseLong(jwt.getSubject());
        } catch (NumberFormatException | NullPointerException invalid) {
            throw new JwtException("subject is not an account id");
        }
        return UsernamePasswordAuthenticationToken.authenticated(
                new AccountPrincipal(owner), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }

    public JwtDecoder decoder() {
        return decoder;
    }

    public Duration refreshLifetime() {
        return refreshLifetime;
    }

    /** 매일 04:30(KST) 만료된 지 하루가 지난 refresh 토큰 행을 지운다. */
    @Scheduled(cron = "0 30 4 * * *", zone = "Asia/Seoul")
    public void purgeExpired() {
        int removed = refreshTokens.purgeExpired(clock.instant().minus(Duration.ofDays(1)));
        if (removed > 0) log.info("removed {} expired refresh tokens", removed);
    }

    private Issued issue(long owner, Instant now) {
        var claims =
                JwtClaimsSet.builder()
                        .subject(Long.toString(owner))
                        .issuedAt(now)
                        .expiresAt(now.plus(accessLifetime))
                        .build();
        String access =
                encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                        .getTokenValue();
        var bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        refreshTokens.insert(owner, hash(refresh), now, now.plus(refreshLifetime));
        return new Issued(owner, access, accessLifetime.toSeconds(), refresh);
    }

    static String hash(String token) {
        return Json.sha256(token.getBytes(StandardCharsets.UTF_8));
    }

    /** 서명 키: 설정값(32바이트 이상). 비어 있으면 실행마다 새로 만든다 — 재시작하면 모든 access 토큰이 무효다. */
    static SecretKey key(String secret) {
        byte[] bytes;
        if (secret == null || secret.isBlank()) {
            log.warn("posegood.auth.jwt-secret is empty; using a random key (access tokens die on restart)");
            bytes = new byte[32];
            RANDOM.nextBytes(bytes);
        } else {
            bytes = secret.getBytes(StandardCharsets.UTF_8);
            if (bytes.length < 32)
                throw new IllegalStateException("posegood.auth.jwt-secret must be at least 32 bytes");
        }
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    private static ApiError expired() {
        return new ApiError(401, "UNAUTHENTICATED", "login expired; sign in again");
    }

    private static ApiError unauthenticated() {
        return new ApiError(401, "UNAUTHENTICATED", "authentication required");
    }
}
