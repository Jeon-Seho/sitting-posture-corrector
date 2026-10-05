package org.posegood.api.account;

import org.posegood.api.persistence.JsonCodec;
import org.posegood.api.web.ApiError;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

@Repository
@Profile("persistent")
public class UserStore {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final TransactionTemplate tx;

    public UserStore(JdbcTemplate jdbc, JsonCodec json, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.json = json;
        this.tx = tx;
    }

    public User findEmail(String email) {
        return first(
                jdbc.query(
                        "SELECT id,email,password_hash,profile,auth_epoch FROM users WHERE email=?",
                        (row, n) ->
                                new User(
                                        UUID.fromString(row.getString("id")),
                                        row.getString("email"),
                                        row.getString("password_hash"),
                                        json.read(
                                                row.getString("profile"),
                                                AccountContracts.Profile.class),
                                        row.getLong("auth_epoch")),
                        email));
    }

    public User require(UUID id) {
        var user =
                first(
                        jdbc.query(
                                "SELECT id,email,password_hash,profile,auth_epoch FROM users WHERE"
                                        + " id=?",
                                (row, n) ->
                                        new User(
                                                UUID.fromString(row.getString("id")),
                                                row.getString("email"),
                                                row.getString("password_hash"),
                                                json.read(
                                                        row.getString("profile"),
                                                        AccountContracts.Profile.class),
                                                row.getLong("auth_epoch")),
                                id.toString()));
        if (user == null) throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        return user;
    }

    public User register(String email, String hash, AccountContracts.Profile profile) {
        UUID id = UUID.randomUUID();
        try {
            tx.executeWithoutResult(
                    status -> {
                        jdbc.update(
                                "INSERT INTO users(id,email,password_hash,profile,consent_version)"
                                        + " VALUES(?,?,?,?,?)",
                                id.toString(),
                                email,
                                hash,
                                json.write(profile),
                                "service-v1");
                        jdbc.update(
                                "INSERT INTO workspaces(user_id,rules,preferences) VALUES(?,?,?)",
                                id.toString(),
                                "{\"holdSeconds\":3,\"recoverSeconds\":2,\"realertSeconds\":60,\"threshold\":0.7}",
                                "{\"show_demo\":false,\"alerts_on\":true}");
                    });
        } catch (DuplicateKeyException conflict) {
            throw new ApiError(409, "ACCOUNT_EXISTS", "account cannot be registered");
        }
        return require(id);
    }

    public void updateProfile(UUID id, AccountContracts.Profile profile) {
        jdbc.update("UPDATE users SET profile=? WHERE id=?", json.write(profile), id.toString());
    }

    public void changePassword(UUID id, String hash) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "UPDATE users SET password_hash=?,auth_epoch=auth_epoch+1 WHERE id=?",
                            hash,
                            id.toString());
                    removeLogins(id);
                });
    }

    public void delete(UUID id) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "INSERT IGNORE INTO cep_cleanup(session_id) SELECT id FROM"
                                    + " measurement_sessions WHERE user_id=?",
                            id.toString());
                    removeLogins(id);
                    jdbc.update("DELETE FROM users WHERE id=?", id.toString());
                });
    }

    private void removeLogins(UUID id) {
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?", id.toString());
    }

    private static <T> T first(List<T> values) {
        return values.isEmpty() ? null : values.getFirst();
    }

    public record User(
            UUID id, String email, String hash, AccountContracts.Profile profile, long epoch) {
        public AccountContracts.View view() {
            return new AccountContracts.View(id, email, profile);
        }
    }
}
