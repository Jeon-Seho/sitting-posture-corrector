"""Restore into an empty MySQL schema while API/frontend remain stopped."""

import gzip
import json
import subprocess
import threading

from .compose import command, run
from .secrets import ROOT


def compose_rows(value):
    try:
        document = json.loads(value)
        return document if isinstance(document, list) else [document]
    except json.JSONDecodeError:
        return [json.loads(line) for line in value.splitlines() if line.strip()]


def query(project, sql, env, root=ROOT):
    result = run(project, "exec", "-T", "db", "mysql",
                 "--defaults-extra-file=/run/secrets/mysql-app.cnf", "--batch",
                 "--skip-column-names", "--execute=" + sql, "posegood",
                 env=env, root=root, capture=True, timeout=30)
    return result.stdout.strip()


def require_empty_target(project, env, root=ROOT):
    containers = compose_rows(run(project, "ps", "--all", "--format", "json",
                                  env=env, root=root, capture=True).stdout or "[]")
    for container in containers:
        if container.get("Service") in ("api", "frontend") and container.get("State") == "running":
            raise ValueError("Restore requires API and frontend to be stopped")
    count = query(project, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='posegood'", env, root)
    if count != "0":
        raise ValueError("Restore requires an empty posegood schema; existing tables are never overwritten")


def restore_database(project, source, env, root=ROOT):
    require_empty_target(project, env, root)
    arguments = command(project, root) + [
        "exec", "-T", "db", "mysql", "--defaults-extra-file=/run/secrets/mysql-app.cnf", "posegood",
    ]
    process = subprocess.Popen(arguments, cwd=root, env=env, stdin=subprocess.PIPE,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = threading.Timer(120, process.kill)
    deadline.start()
    try:
        with gzip.open(source, "rb") as compressed:
            while True:
                chunk = compressed.read(65536)
                if not chunk:
                    break
                process.stdin.write(chunk)
        process.stdin.close()
        if process.wait(timeout=30):
            raise RuntimeError("MySQL restore failed; partial tables were preserved for inspection")
    except BaseException:
        process.kill()
        process.wait(timeout=10)
        raise
    finally:
        deadline.cancel()
