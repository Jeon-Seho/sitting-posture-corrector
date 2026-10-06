package org.posegood.api.account;

import org.posegood.api.persistence.DbTime;
import org.posegood.api.persistence.ThresholdPolicyStore;
import org.posegood.api.web.ApiError;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

/** Schema V1.1 `user_account`. Only ACTIVE accounts authenticate (D-34). */
@Repository
@Profile("persistent")
public class UserStore {
    private static final String COLUMNS =
            "user_account_id,login_email,password_hash,display_name,age,occupation,auth_epoch,"
                    + "threshold_policy_id,sound_alert_enabled";
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ThresholdPolicyStore policies;

    public UserStore(JdbcTemplate jdbc, TransactionTemplate tx, ThresholdPolicyStore policies) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.policies = policies;
    }

    public User findEmail(String email) {
        return first(
                jdbc.query(
                        "SELECT " + COLUMNS + " FROM user_account WHERE login_email=? AND"
                                + " account_status='ACTIVE'",
                        this::user,
                        email));
    }

    public User require(long id) {
        var user =
                first(
                        jdbc.query(
                                "SELECT " + COLUMNS + " FROM user_account WHERE user_account_id=?"
                                        + " AND account_status='ACTIVE'",
                                this::user,
                                id));
        if (user == null) throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
        return user;
    }

    public User register(String email, String hash, AccountContracts.Profile profile) {
        var key = new GeneratedKeyHolder();
        try {
            tx.executeWithoutResult(
                    status -> {
                        long policy = policies.defaultId();
                        // Sound alerts start on, as before; consent is not stored while T-41 is held.
                        jdbc.update(
                                connection -> {
                                    var insert =
                                            connection.prepareStatement(
                                                    "INSERT INTO user_account(login_email,"
                                                        + "password_hash,display_name,account_status,"
                                                        + "joined_at,threshold_policy_id,"
                                                        + "sound_alert_enabled,age,occupation)"
                                                        + " VALUES(?,?,?,'ACTIVE',?,?,TRUE,?,?)",
                                                    Statement.RETURN_GENERATED_KEYS);
                                    insert.setString(1, email);
                                    insert.setString(2, hash);
                                    insert.setString(3, profile.name());
                                    insert.setObject(4, DbTime.now());
                                    insert.setLong(5, policy);
                                    insert.setInt(6, profile.age());
                                    insert.setString(7, profile.occupation());
                                    return insert;
                                },
                                key);
                    });
        } catch (DuplicateKeyException conflict) {
            throw new ApiError(409, "ACCOUNT_EXISTS", "account cannot be registered");
        }
        return require(key.getKey().longValue());
    }

    public void updateSettings(
            long id, AccountContracts.Profile profile, long policy, boolean soundAlerts) {
        jdbc.update(
                "UPDATE user_account SET display_name=?,age=?,occupation=?,threshold_policy_id=?,"
                        + "sound_alert_enabled=? WHERE user_account_id=? AND account_status='ACTIVE'",
                profile.name(),
                profile.age(),
                profile.occupation(),
                policy,
                soundAlerts,
                id);
    }

    public void changePassword(long id, String hash) {
        tx.executeWithoutResult(
                status -> {
                    jdbc.update(
                            "UPDATE user_account SET password_hash=?,auth_epoch=auth_epoch+1 WHERE"
                                    + " user_account_id=?",
                            hash,
                            id);
                    removeLogins(id);
                });
    }

    /**
     * Withdrawal per DB-04 6-1 with a zero retention period: record the request, close the
     * account and clear identity columns, then delete owned rows in child-first order. Sessions
     * with `feature_archive` rows wait for the batch that deletes the files first.
     */
    public void delete(long id) {
        tx.executeWithoutResult(
                status -> {
                    var now = DbTime.now();
                    jdbc.update(
                            "INSERT INTO deletion_request(user_account_id,requested_at,"
                                    + "request_scope,request_status,account_closed_at)"
                                    + " VALUES(?,?,'ACCOUNT_ALL','PROCESSING',?)",
                            id,
                            now,
                            now);
                    jdbc.update(
                            "INSERT IGNORE INTO cep_cleanup(client_session_uuid,created_at) SELECT"
                                    + " client_session_uuid,? FROM monitor_session WHERE"
                                    + " user_account_id=?",
                            now,
                            id);
                    jdbc.update(
                            "UPDATE user_account SET account_status='CLOSED',login_email=NULL,"
                                    + "password_hash=NULL,display_name=NULL,age=NULL,"
                                    + "occupation=NULL,auth_epoch=auth_epoch+1 WHERE"
                                    + " user_account_id=?",
                            id);
                    removeLogins(id);
                    jdbc.update("DELETE FROM client_record WHERE user_account_id=?", id);
                    jdbc.update("DELETE FROM daily_stat WHERE user_account_id=?", id);
                    jdbc.update(
                            "DELETE FROM monitor_session WHERE user_account_id=? AND NOT EXISTS("
                                    + "SELECT 1 FROM feature_archive a WHERE"
                                    + " a.monitor_session_id=monitor_session.monitor_session_id)",
                            id);
                    Integer archived =
                            jdbc.queryForObject(
                                    "SELECT COUNT(*) FROM monitor_session WHERE user_account_id=?",
                                    Integer.class,
                                    id);
                    if (archived != null && archived > 0) return;
                    jdbc.update("DELETE FROM baseline_posture WHERE user_account_id=?", id);
                    jdbc.update("DELETE FROM capture_device WHERE user_account_id=?", id);
                    jdbc.update(
                            "UPDATE deletion_request SET request_status='DONE',data_deleted_at=?"
                                    + " WHERE user_account_id=? AND requested_at=?",
                            DbTime.now(),
                            id,
                            now);
                });
    }

    private void removeLogins(long id) {
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?", Long.toString(id));
    }

    private User user(ResultSet row, int n) throws SQLException {
        return new User(
                row.getLong("user_account_id"),
                row.getString("login_email"),
                row.getString("password_hash"),
                new AccountContracts.Profile(
                        row.getString("display_name"),
                        row.getInt("age"),
                        row.getString("occupation")),
                row.getLong("auth_epoch"),
                row.getLong("threshold_policy_id"),
                row.getBoolean("sound_alert_enabled"));
    }

    private static <T> T first(List<T> values) {
        return values.isEmpty() ? null : values.getFirst();
    }

    public record User(
            long id,
            String email,
            String hash,
            AccountContracts.Profile profile,
            long epoch,
            long policyId,
            boolean soundAlerts) {
        public AccountContracts.View view() {
            return new AccountContracts.View(Long.toString(id), email, profile);
        }
    }
}
