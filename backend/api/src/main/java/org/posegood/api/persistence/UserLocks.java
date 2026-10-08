package org.posegood.api.persistence;

import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.function.Supplier;

import javax.sql.DataSource;

/** MySQL connection-scoped advisory lock. No row transaction stays open during HTTP calls. */
@Component
@Profile("persistent")
public class UserLocks {
    private final DataSource source;

    public UserLocks(DataSource source) {
        this.source = source;
    }

    public <T> T withLock(long user, Supplier<T> work) {
        if (TransactionSynchronizationManager.hasResource(source)) {
            throw new IllegalStateException("account lock must be acquired outside a transaction");
        }
        String name = "posegood-user-" + user;
        try (Connection connection = source.getConnection()) {
            boolean acquired = false;
            boolean bound = false;
            try {
                try (var query = connection.prepareStatement("SELECT GET_LOCK(?, 2)")) {
                    query.setString(1, name);
                    try (var result = query.executeQuery()) {
                        if (!result.next() || result.getInt(1) != 1 || result.wasNull()) {
                            throw new org.posegood.api.web.ApiError(
                                    503,
                                    "ACCOUNT_BUSY",
                                    "another account operation is in progress; retry same request");
                        }
                        acquired = true;
                    }
                }
                TransactionSynchronizationManager.bindResource(
                        source, new ConnectionHolder(connection));
                bound = true;
                return work.get();
            } finally {
                if (bound) TransactionSynchronizationManager.unbindResource(source);
                // A pooled connection must never retain a named lock after it is returned.
                if (acquired) {
                    try (var query = connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
                        query.setString(1, name);
                        try (var result = query.executeQuery()) {
                            if (!result.next() || result.getInt(1) != 1 || result.wasNull()) {
                                connection.abort(Runnable::run);
                                throw new IllegalStateException(
                                        "database advisory lock release failed");
                            }
                        }
                    } catch (SQLException failure) {
                        connection.abort(Runnable::run);
                        throw failure;
                    }
                }
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("database coordination unavailable");
        }
    }
}
