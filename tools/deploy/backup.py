"""Stream a consistent MySQL dump into a new private gzip file."""

import gzip
import os
import subprocess
import threading
from pathlib import Path

from .compose import DATABASE, command
from .secrets import ROOT, private_location


def backup_database(project, destination, env, root=ROOT):
    target = private_location(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    arguments = command(project, root) + [
        "exec", "-T", "db", "mysqldump",
        "--defaults-extra-file=/run/secrets/mysql-backup.cnf", "--single-transaction",
        "--routines", "--events", "--triggers", "--no-tablespaces",
        "--set-gtid-purged=OFF", DATABASE,
    ]
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        process = None
        deadline = None
        try:
            process = subprocess.Popen(
                arguments,
                cwd=root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            deadline = threading.Timer(120, process.kill)
            deadline.start()
            with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as compressed:
                while True:
                    chunk = process.stdout.read(65536)
                    if not chunk:
                        break
                    compressed.write(chunk)
            process.communicate(timeout=30)
            if process.returncode:
                raise RuntimeError("MySQL backup failed; deployment was not started")
        except BaseException:
            if process is not None:
                process.kill()
                process.wait(timeout=10)
            target.unlink(missing_ok=True)
            raise
        finally:
            if deadline is not None:
                deadline.cancel()
    return target
