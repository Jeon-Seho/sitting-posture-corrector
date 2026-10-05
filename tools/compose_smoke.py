"""Build an isolated real Compose stack, verify persistence, then remove only that stack."""

import json
import re
import socket
import subprocess
import tempfile
import uuid
from pathlib import Path

from deploy.backup import backup_database
from deploy.compose import assert_project_removed, command, environment, loopback_publication, require_daemon
from deploy.secrets import ROOT, create_secrets
from deploy.smoke import exercise_accounts, verify_frontend, verify_restart_and_finish, wait_health
from deploy.restore import query, restore_database
from account_browser_smoke import verify_account_browser
from runtime import maven_executable


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def invoke(project, env, *arguments, capture=False, timeout=900):
    # The verification-only overlay never affects the ordinary Compose invocation.
    arguments = command(project) + ["--file", str(ROOT / "compose.test.yaml")] + list(arguments)
    return subprocess.run(arguments, cwd=ROOT, env=env, check=True, timeout=timeout,
                          capture_output=capture, text=True)


def mysql_address(project, env):
    # Configured ports alone do not prove NAT exists on an internal-only bridge.
    # Engine inspect provides the actual binding; public/missing/ambiguous values fail.
    return loopback_publication(project, "db", 3306, env)


def mysql_integration(project, env, secret_directory):
    address = mysql_address(project, env)
    integration = env.copy()
    integration["POSEGOOD_TEST_MYSQL_URL"] = "jdbc:mysql://" + address + "/posegood?connectionTimeZone=UTC"
    integration["POSEGOOD_TEST_MYSQL_USER"] = "posegood"
    integration["POSEGOOD_TEST_MYSQL_PASSWORD"] = (secret_directory / "spring.datasource.password").read_text()
    integration["POSEGOOD_TEST_MYSQL_DISPOSABLE"] = "true"
    integration["POSEGOOD_TEST_MYSQL_SYNTHETIC"] = "true"
    settings = "tools/maven-settings.xml"
    cache = integration.get("POSEGOOD_MAVEN_CACHE", str(ROOT / ".cache" / "maven"))
    subprocess.run(
        [
            maven_executable(), "-B", "-ntp", "-s", settings, "-gs", settings,
            "-Dmaven.repo.local=" + cache,
            "-f", "backend/pom.xml", "-pl", "api", "-am", "-Pmysql-integration", "verify",
        ],
        cwd=ROOT, env=integration, check=True, timeout=600,
    )


def verify_internal_auth(project, env):
    # Run inside the private network: these services intentionally have no host ports.
    script = """
import urllib.error
import urllib.request
urls = (
    'http://cep:8091/internal/sessions/00000000-0000-4000-8000-000000000001',
    'http://inference:8092/v2/infer',
)
for url in urls:
    for headers in ({}, {'X-PoseGood-Internal-Token': 'explicit-synthetic-invalid-token'}):
        request = urllib.request.Request(url, headers=headers)
        try:
            urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise AssertionError('Internal authentication returned ' + str(error.code))
        else:
            raise AssertionError('An internal route accepted a missing or wrong token')
print('PASS: four private-network missing/wrong-token requests rejected with 401')
"""
    invoke(project, env, "exec", "-T", "inference", "python", "-c", script, timeout=30)
    return 4


def check_ports_closed(port):
    with socket.socket() as connection:
        connection.settimeout(1)
        if connection.connect_ex(("127.0.0.1", port)) == 0:
            raise AssertionError("The verification frontend port is still accepting connections")


def row_counts(project, env):
    tables = query(project, "SELECT table_name FROM information_schema.tables WHERE table_schema='posegood' ORDER BY table_name", env).splitlines()
    if any(not re.fullmatch(r"[A-Za-z0-9_]+", table) for table in tables):
        raise ValueError("Unexpected database table identifier")
    return {table: int(query(project, "SELECT COUNT(*) FROM `" + table + "`", env)) for table in tables}


def verify_restore(project, env, source, expected, secret_directory):
    recovery = project + "-restore"
    database_port = None
    try:
        invoke(recovery, env, "up", "--wait", "--wait-timeout", "120", "db")
        database_port = int(mysql_address(recovery, env).split(":")[1])
        restore_database(recovery, source, env)
        if row_counts(recovery, env) != expected:
            raise AssertionError("Restored synthetic table counts differ from the source snapshot")
        invoke(recovery, env, "up", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "120", "db")
        if row_counts(recovery, env) != expected:
            raise AssertionError("Restored rows were lost after MySQL restarted on the same volume")
        mysql_integration(recovery, env, secret_directory)
        print("PASS: empty-target synthetic restore, exact row counts, MySQL remount and Flyway/integration verification", flush=True)
    finally:
        try:
            invoke(recovery, env, "down", "--volumes", "--remove-orphans", timeout=120)
        finally:
            if database_port is not None:
                check_ports_closed(database_port)
            assert_project_removed(recovery, env)


def main():
    version = require_daemon()
    print("Docker daemon " + version + "; real Compose verification is mandatory.", flush=True)
    project = "posegood-smoke-" + uuid.uuid4().hex[:12]
    port = free_port()
    # Docker Desktop may not have permission to bind files from macOS Desktop.
    # Disposable credentials belong in an isolated private system temporary folder.
    with tempfile.TemporaryDirectory(prefix="posegood-compose-smoke-") as temporary:
        folder = Path(temporary)
        secret_directory = create_secrets(folder / "secrets")
        env = environment(secret_directory, port)
        env["POSEGOOD_COOKIE_SECURE"] = "false"
        for service in ("api", "cep", "inference", "frontend"):
            env["POSEGOOD_" + service.upper() + "_IMAGE"] = "posegood-" + service + ":local"
        base = "http://127.0.0.1:" + str(port) + "/api"
        database_port = None
        try:
            invoke(project, env, "up", "--build", "--wait", "--wait-timeout", "180")
            database_port = int(mysql_address(project, env).split(":")[1])
            wait_health(base)
            frontend_checks = verify_frontend(base.removesuffix("/api"))
            internal_checks = verify_internal_auth(project, env)
            configuration = json.loads(invoke(project, env, "config", "--format", "json", capture=True).stdout)
            for service in ("api", "cep", "inference"):
                if configuration["services"][service].get("ports"):
                    raise AssertionError("An internal application service was published to the host")
            state = exercise_accounts(base)
            counts = row_counts(project, env)
            backup = backup_database(project, folder / "synthetic-backup.sql.gz", env)
            # A replacement container may receive a new IP; NGINX must follow Docker DNS.
            invoke(project, env, "up", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "120", "api", "cep")
            wait_health(base)
            count = verify_restart_and_finish(base, state)
            browser_checks = verify_account_browser(base.removesuffix("/api"))
            invoke(project, env, "stop", "api", "frontend")
            mysql_integration(project, env, secret_directory)
            verify_restore(project, env, backup, counts, secret_directory)
            print("PASS: " + str(count + frontend_checks + internal_checks + browser_checks + 5) + " real Compose checks and mandatory MySQL integration profiles; synthetic accounts/features only", flush=True)
        except BaseException:
            try:
                invoke(project, env, "logs", "--tail", "100", timeout=30)
            except (subprocess.SubprocessError, OSError):
                print("Compose logs could not be read; the original verification failure is retained.", flush=True)
            raise
        finally:
            # This random project owns every resource removed here; ordinary posegood is untouched.
            try:
                invoke(project, env, "down", "--volumes", "--remove-orphans", timeout=120)
            finally:
                check_ports_closed(port)
                if database_port is not None:
                    check_ports_closed(database_port)
                assert_project_removed(project, env)
            print("PASS: verification containers, networks, private volume and published ports were cleaned up.", flush=True)


if __name__ == "__main__":
    main()
