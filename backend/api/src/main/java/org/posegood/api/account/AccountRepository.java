package org.posegood.api.account;

import org.posegood.api.common.ApiError;
import org.posegood.api.common.KstTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;

/**
 * `user_account`, `deletion_request` and the login sessions of schema V2.2. Identity columns are
 * NOT NULL (CR-04): a withdrawn account keeps them during the grace period and is deleted whole.
 * Logins are revoked by deleting the user's `SPRING_SESSION` rows (V2.1 dropped `auth_epoch`).
 */
@Repository
public class AccountRepository {
    private static final String COLUMNS =
            "user_account_id,login_email,password_hash,display_name,age,occupation,account_status,"
                    + "threshold_policy_id,alert_enabled";

    private final JdbcTemplate jdbc;

    public AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Any status; the caller decides what a CLOSED account may do. */
    public Account findEmail(String email) {
        return first(
                jdbc.query(
                        "SELECT " + COLUMNS + " FROM user_account WHERE login_email=?",
                        this::account,
                        email));
    }

    public Account find(long id) {
        return first(
                jdbc.query(
                        "SELECT " + COLUMNS + " FROM user_account WHERE user_account_id=?",
                        this::account,
                        id));
    }

    /**
     * Posture alerts start on and sound off (column defaults, V2.2); consent is not stored while
     * T-41 is on hold.
     */
    public long insert(String email, String hash, AccountContracts.Profile profile, long policy) {
        var key = new GeneratedKeyHolder();
        try {
            jdbc.update(
                    connection -> {
                        var insert =
                                connection.prepareStatement(
                                        "INSERT INTO user_account(login_email,password_hash,"
                                                + "display_name,account_status,joined_at,"
                                                + "threshold_policy_id,age,occupation)"
                                                + " VALUES(?,?,?,'ACTIVE',?,?,?,?)",
                                        Statement.RETURN_GENERATED_KEYS);
                        insert.setString(1, email);
                        insert.setString(2, hash);
                        insert.setString(3, profile.name());
                        insert.setObject(4, KstTime.now());
                        insert.setLong(5, policy);
                        insert.setInt(6, profile.age());
                        insert.setString(7, profile.occupation());
                        return insert;
                    },
                    key);
        } catch (DuplicateKeyException exists) {
            // UK-01 also covers an account inside its withdrawal grace period.
            throw new ApiError(409, "ACCOUNT_EXISTS", "account cannot be registered");
        }
        return key.getKey().longValue();
    }

    /** {@code alerts} is the 「자세 알림」 switch; `sound_alert_enabled` has no app setting yet. */
    public void updateSettings(long id, AccountContracts.Profile profile, long policy, boolean alerts) {
        jdbc.update(
                "UPDATE user_account SET display_name=?,age=?,occupation=?,threshold_policy_id=?,"
                        + "alert_enabled=? WHERE user_account_id=? AND account_status='ACTIVE'",
                profile.name(),
                profile.age(),
                profile.occupation(),
                policy,
                alerts,
                id);
    }

    public void changePassword(long id, String hash) {
        jdbc.update("UPDATE user_account SET password_hash=? WHERE user_account_id=?", hash, id);
    }

    /** Withdrawal intake (DB-04 6-1): request row and CLOSED status in the caller's transaction. */
    public void close(long id, LocalDateTime at) {
        jdbc.update(
                "INSERT INTO deletion_request(user_account_id,requested_at,request_scope,"
                        + "request_status,account_closed_at) VALUES(?,?,'ACCOUNT_ALL','REQUESTED',?)",
                id,
                at,
                at);
        jdbc.update(
                "UPDATE user_account SET account_status='CLOSED' WHERE user_account_id=? AND"
                        + " account_status='ACTIVE'",
                id);
    }

    /** Withdrawal cancel (DB-04 6-1-1): only a REQUESTED row; no history is kept. */
    public boolean reopen(long id) {
        var requests =
                jdbc.queryForList(
                        "SELECT request_status FROM deletion_request WHERE user_account_id=? AND"
                                + " request_scope='ACCOUNT_ALL' FOR UPDATE",
                        String.class,
                        id);
        if (requests.size() != 1 || !"REQUESTED".equals(requests.getFirst())) return false;
        jdbc.update(
                "DELETE FROM deletion_request WHERE user_account_id=? AND request_scope='ACCOUNT_ALL'",
                id);
        jdbc.update(
                "UPDATE user_account SET account_status='ACTIVE' WHERE user_account_id=? AND"
                        + " account_status='CLOSED'",
                id);
        return true;
    }

    /** Every login of the user; `PRINCIPAL_NAME` is the decimal account id ({@link AccountPrincipal}). */
    public void removeLogins(long id) {
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?", Long.toString(id));
    }

    /** Accounts whose grace period ended: `account_closed_at + grace <= now` (no due-date column). */
    public List<Long> withdrawalsDue(LocalDateTime now, int graceDays) {
        return jdbc.queryForList(
                "SELECT user_account_id FROM deletion_request WHERE request_scope='ACCOUNT_ALL' AND"
                        + " request_status IN ('REQUESTED','FAILED') AND account_closed_at IS NOT NULL"
                        + " AND account_closed_at <= ? ORDER BY account_closed_at LIMIT 100",
                Long.class,
                now.minusDays(graceDays));
    }

    public int pendingArchiveFiles(long id) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM feature_archive a JOIN monitor_session m ON"
                        + " m.monitor_session_id=a.monitor_session_id WHERE m.user_account_id=? AND"
                        + " a.deleted_at IS NULL",
                Integer.class,
                id);
    }

    public void markWithdrawalFailed(long id, String reason) {
        jdbc.update(
                "UPDATE deletion_request SET request_status='FAILED',failure_reason=? WHERE"
                        + " user_account_id=? AND request_scope='ACCOUNT_ALL'",
                reason,
                id);
    }

    /**
     * Final deletion, child rows first, in the caller's single transaction (DB-04 6-1). Only
     * archive rows whose files were already removed may exist.
     */
    public void deleteWithdrawn(long id) {
        jdbc.update(
                "DELETE a FROM feature_archive a JOIN monitor_session m ON"
                        + " m.monitor_session_id=a.monitor_session_id WHERE m.user_account_id=?",
                id);
        jdbc.update("DELETE FROM monitor_session WHERE user_account_id=?", id);
        jdbc.update("DELETE FROM daily_stat WHERE user_account_id=?", id);
        jdbc.update("DELETE FROM baseline_posture WHERE user_account_id=?", id);
        jdbc.update("DELETE FROM deletion_request WHERE user_account_id=?", id);
        jdbc.update("DELETE FROM user_account WHERE user_account_id=? AND account_status='CLOSED'", id);
    }

    private Account account(ResultSet row, int n) throws SQLException {
        return new Account(
                row.getLong("user_account_id"),
                row.getString("login_email"),
                row.getString("password_hash"),
                new AccountContracts.Profile(
                        row.getString("display_name"), row.getInt("age"), row.getString("occupation")),
                "ACTIVE".equals(row.getString("account_status")),
                row.getLong("threshold_policy_id"),
                row.getBoolean("alert_enabled"));
    }

    private static <T> T first(List<T> values) {
        return values.isEmpty() ? null : values.getFirst();
    }

    public record Account(
            long id,
            String email,
            String hash,
            AccountContracts.Profile profile,
            boolean active,
            long policyId,
            boolean alertsEnabled) {
        public AccountContracts.View view() {
            return new AccountContracts.View(Long.toString(id), email, profile);
        }
    }
}
