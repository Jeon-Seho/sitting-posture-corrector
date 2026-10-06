package org.posegood.api.persistence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.UUID;

import javax.sql.DataSource;

class UserLocksTest {
    @Test
    void busyLockIsRetryableInsteadOfAConfirmedInputRejection() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        var query = mock(PreparedStatement.class);
        var result = mock(ResultSet.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.prepareStatement("SELECT GET_LOCK(?, 2)")).thenReturn(query);
        when(query.executeQuery()).thenReturn(result);
        when(result.next()).thenReturn(true);
        when(result.getInt(1)).thenReturn(0);
        assertEquals(
                503,
                assertThrows(
                                org.posegood.contracts.ContractError.class,
                                () ->
                                        new UserLocks(source)
                                                .withLock(
                                                        42L,
                                                        () -> fail("busy work must not run")))
                        .status());
        verify(connection).close();
        assertFalse(TransactionSynchronizationManager.hasResource(source));
    }

    @Test
    void existingTransactionIsRejectedBeforeConnectionOrLockAcquisition() throws Exception {
        var source = mock(DataSource.class);
        TransactionSynchronizationManager.bindResource(source, new Object());
        try {
            assertThrows(
                    IllegalStateException.class,
                    () -> new UserLocks(source).withLock(42L, () -> null));
            verifyNoInteractions(source);
        } finally {
            TransactionSynchronizationManager.unbindResource(source);
        }
    }

    @Test
    void failedWorkReleasesLockAndThreadBindingBeforePoolReturn() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        var acquire = mock(PreparedStatement.class);
        var release = mock(PreparedStatement.class);
        var yes = mock(ResultSet.class);
        when(connection.prepareStatement("SELECT GET_LOCK(?, 2)")).thenReturn(acquire);
        when(connection.prepareStatement("SELECT RELEASE_LOCK(?)")).thenReturn(release);
        when(acquire.executeQuery()).thenReturn(yes);
        when(release.executeQuery()).thenReturn(yes);
        when(yes.next()).thenReturn(true);
        when(yes.getInt(1)).thenReturn(1);
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new UserLocks(source)
                                .withLock(
                                        42L,
                                        () -> {
                                            assertTrue(
                                                    TransactionSynchronizationManager.hasResource(
                                                            source));
                                            throw new IllegalArgumentException(
                                                    "synthetic work failure");
                                        }));
        assertFalse(TransactionSynchronizationManager.hasResource(source));
        verify(release).executeQuery();
        verify(connection).close();
        verify(connection, never()).abort(any());
    }

    @Test
    void failedReleaseAbortsPhysicalConnectionInsteadOfReturningNamedLock() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        var acquire = mock(PreparedStatement.class);
        var release = mock(PreparedStatement.class);
        var yes = mock(ResultSet.class);
        var no = mock(ResultSet.class);
        when(connection.prepareStatement("SELECT GET_LOCK(?, 2)")).thenReturn(acquire);
        when(connection.prepareStatement("SELECT RELEASE_LOCK(?)")).thenReturn(release);
        when(acquire.executeQuery()).thenReturn(yes);
        when(release.executeQuery()).thenReturn(no);
        when(yes.next()).thenReturn(true);
        when(yes.getInt(1)).thenReturn(1);
        when(no.next()).thenReturn(true);
        when(no.getInt(1)).thenReturn(0);
        assertThrows(
                IllegalStateException.class,
                () -> new UserLocks(source).withLock(42L, () -> "synthetic result"));
        verify(connection).abort(any());
        assertFalse(TransactionSynchronizationManager.hasResource(source));
    }
}
