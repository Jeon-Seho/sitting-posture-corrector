"""Disposable MySQL for backend verification; only synthetic accounts and inputs are written.

A loopback server is chosen in this order and never skipped:
1. POSEGOOD_TEST_MYSQL_PASSWORD, or the Git-ignored .cache/test-mysql-password file, with
   POSEGOOD_TEST_MYSQL_URL (default jdbc:mysql://127.0.0.1:3306/) and POSEGOOD_TEST_MYSQL_USER
   (default root). The account needs CREATE/DROP DATABASE.
2. Otherwise a temporary Docker container of the Compose MySQL image, removed afterwards.

Each database is named posture_service_it_<random> and built from the DB owner's unchanged
schema_V2_6.sql and seed (only the database name is substituted).
"""

import os
import re
import secrets
import shutil
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass

if __package__:
    from .runtime import ROOT
else:
    from runtime import ROOT

IMAGE = "mysql:8.4.11@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242"
SEEDS = ("seed_04_threshold_policy.sql",)
LOOPBACK = re.compile(r"jdbc:mysql://(127\.0\.0\.1|localhost)(?::([0-9]+))?/")


@dataclass(frozen=True)
class MySqlServer:
    host: str
    port: int
    user: str
    password: str

    @property
    def url(self):
        return f"jdbc:mysql://{self.host}:{self.port}/"

    def environment(self):
        """Variables read by backend/api/src/test/.../DisposableDatabase.java."""
        return dict(
            os.environ,
            POSEGOOD_TEST_MYSQL_URL=self.url,
            POSEGOOD_TEST_MYSQL_USER=self.user,
            POSEGOOD_TEST_MYSQL_PASSWORD=self.password,
        )

    def connect(self, database=None):
        import pymysql
        from pymysql.constants import CLIENT

        return pymysql.connect(
            host=self.host, port=self.port, user=self.user, password=self.password,
            database=database, charset="utf8mb4", client_flag=CLIENT.MULTI_STATEMENTS,
            autocommit=True,
        )


@dataclass(frozen=True)
class Database:
    server: MySqlServer
    name: str

    @property
    def jdbc_url(self):
        return (f"{self.server.url}{self.name}"
                "?connectionTimeZone=Asia/Seoul")


def configured_server():
    password = os.environ.get("POSEGOOD_TEST_MYSQL_PASSWORD")
    secret = ROOT / ".cache/test-mysql-password"
    if not password and secret.is_file():
        password = secret.read_text(encoding="utf-8").strip()
    if not password:
        return None
    url = os.environ.get("POSEGOOD_TEST_MYSQL_URL", "jdbc:mysql://127.0.0.1:3306/")
    match = LOOPBACK.match(url)
    if not match:
        raise RuntimeError("시험용 MySQL은 loopback 주소만 사용합니다.")
    return MySqlServer("127.0.0.1", int(match.group(2) or 3306),
                       os.environ.get("POSEGOOD_TEST_MYSQL_USER", "root"), password)


@contextmanager
def mysql_server():
    server = configured_server()
    if server is not None:
        yield server
        return
    docker = shutil.which("docker")
    if docker is None:
        raise RuntimeError(
            "백엔드 검증에는 MySQL이 필요합니다. POSEGOOD_TEST_MYSQL_PASSWORD 또는 "
            ".cache/test-mysql-password로 loopback MySQL을 지정하거나 Docker를 준비하세요. 검증을 생략하지 않습니다.")
    password = secrets.token_urlsafe(24)
    name = "posegood-test-mysql-" + secrets.token_hex(4)
    subprocess.run([
        docker, "run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1::3306",
        "--env", "MYSQL_ROOT_PASSWORD=" + password, IMAGE,
    ], check=True, stdout=subprocess.DEVNULL)
    try:
        published = subprocess.check_output([docker, "port", name, "3306/tcp"], text=True)
        port = int(published.strip().splitlines()[0].rsplit(":", 1)[1])
        server = MySqlServer("127.0.0.1", port, "root", password)
        wait_ready(server)
        print("PASS: temporary MySQL container is ready", flush=True)
        yield server
    finally:
        subprocess.run([docker, "rm", "--force", name], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("PASS: temporary MySQL container removed", flush=True)


def wait_ready(server, timeout=120):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            with server.connect() as connection, connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return
        except Exception as error:  # noqa: BLE001 - the container is still initializing
            last = error
            time.sleep(1)
    # The last error tells a missing driver dependency apart from a slow container.
    raise RuntimeError(f"시험용 MySQL이 준비되지 않았습니다: {type(last).__name__}: {last}")


def script(path, name):
    text = (ROOT / path).read_text(encoding="utf-8")
    return (text.replace("CREATE DATABASE IF NOT EXISTS posture_service ", f"CREATE DATABASE {name} ")
            .replace("USE posture_service;", f"USE {name};"))


@contextmanager
def disposable_database(server):
    name = "posture_service_it_" + secrets.token_hex(4)
    database = Database(server, name)
    try:
        with server.connect() as connection, connection.cursor() as cursor:
            for path in ["database/schema/schema_V2_6.sql", *(f"database/seed/{seed}" for seed in SEEDS)]:
                cursor.execute(script(path, name))
                while cursor.nextset():
                    pass
        yield database
    finally:
        with server.connect() as connection, connection.cursor() as cursor:
            cursor.execute(f"DROP DATABASE IF EXISTS {name}")
        print(f"PASS: disposable database {name} dropped", flush=True)


def query(database, sql, *args):
    with database.server.connect(database.name) as connection, connection.cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()

