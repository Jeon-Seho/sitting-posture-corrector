package org.posegood.api.it;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.Properties;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

/**
 * A uniquely named database on a loopback MySQL server, built from the DB owner's unchanged
 * `schema_V2_2.sql` and seed (only the database name is substituted) and dropped afterwards.
 *
 * <p>Environment: {@code POSEGOOD_TEST_MYSQL_URL} (default {@code jdbc:mysql://127.0.0.1:3306/}),
 * {@code POSEGOOD_TEST_MYSQL_USER} (default {@code root}), {@code POSEGOOD_TEST_MYSQL_PASSWORD}.
 * The account needs CREATE and DROP DATABASE. Only synthetic accounts and inputs are written.
 */
public final class DisposableDatabase implements AutoCloseable {
    private static final Pattern LOOPBACK = Pattern.compile("jdbc:mysql://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?/.*");
    private static final Path ROOT = locateRoot();

    private final String server;
    private final Properties credentials;
    private final String name;

    private DisposableDatabase(String server, Properties credentials, String name) {
        this.server = server;
        this.credentials = credentials;
        this.name = name;
    }

    public static DisposableDatabase create() throws Exception {
        String server = env("POSEGOOD_TEST_MYSQL_URL", "jdbc:mysql://127.0.0.1:3306/");
        if (!LOOPBACK.matcher(server).matches())
            throw new IllegalStateException("integration tests use a loopback MySQL server only");
        var credentials = new Properties();
        credentials.setProperty("user", env("POSEGOOD_TEST_MYSQL_USER", "root"));
        credentials.setProperty("password", env("POSEGOOD_TEST_MYSQL_PASSWORD", ""));
        credentials.setProperty("allowMultiQueries", "true");
        String name = "posture_service_it_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
        var database = new DisposableDatabase(server, credentials, name);
        try (Connection connection = DriverManager.getConnection(server, credentials);
                var statement = connection.createStatement()) {
            run(statement, script("database/schema/schema_V2_2.sql", name));
            run(statement, script("database/seed/seed_04_threshold_policy.sql", name));
        } catch (SQLException failure) {
            database.close();
            throw failure;
        }
        return database;
    }

    public String name() {
        return name;
    }

    /** JDBC URL for the API: KST session time zone as in production (CR-04). */
    public String url() {
        return server.replaceFirst("/[^/]*$", "/")
                + name
                + "?connectionTimeZone=Asia/Seoul";
    }

    public String user() {
        return credentials.getProperty("user");
    }

    public String password() {
        return credentials.getProperty("password");
    }

    public Connection connect() throws SQLException {
        return DriverManager.getConnection(url(), credentials);
    }

    @Override
    public void close() throws SQLException {
        try (Connection connection = DriverManager.getConnection(server, credentials);
                var statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + name);
        }
    }

    /** Reads every result of a multi-statement script so that a later failing statement throws. */
    private static void run(java.sql.Statement statement, String sql) throws SQLException {
        boolean result = statement.execute(sql);
        while (result || statement.getUpdateCount() != -1) result = statement.getMoreResults();
    }

    private static String script(String file, String name) throws IOException {
        var text = Files.readString(ROOT.resolve(file), StandardCharsets.UTF_8);
        return text.replace("CREATE DATABASE IF NOT EXISTS posture_service ", "CREATE DATABASE " + name + " ")
                .replace("USE posture_service;", "USE " + name + ";");
    }

    private static String env(String key, String fallback) {
        var value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static Path locateRoot() {
        var path = Path.of("").toAbsolutePath();
        while (path != null && !Files.isDirectory(path.resolve("database/schema"))) path = path.getParent();
        if (path == null) throw new IllegalStateException("repository root not found");
        return path;
    }
}
