"""Create file-mounted secrets without printing or embedding their values."""

import os
import re
import secrets
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SECRET_NAMES = (
    "spring.datasource.password", "mysql_root_password", "posegood.internal-token",
    "mysql-backup.cnf", "mysql-app.cnf",
)


def secret_value(value, name):
    if not isinstance(value, str) or len(value) < 32 or any(char in value for char in "\r\n\x00"):
        raise ValueError(name + " must contain at least 32 characters on one line")
    if name in ("posegood.internal-token", "POSEGOOD_INTERNAL_TOKEN") and not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", value):
        raise ValueError("Internal token must contain 32 to 512 ASCII URL-safe characters")
    return value


def private_location(path):
    target = Path(path).resolve()
    if target == ROOT or ROOT in target.parents:
        ignored = subprocess.run(
            ["git", "check-ignore", "--quiet", "--no-index", str(target / "secret")],
            cwd=ROOT, capture_output=True,
        )
        if ignored.returncode != 0:
            raise ValueError("Secrets must be outside the repository or in a Git-ignored directory")
    return target


def mysql_options(user, password):
    escaped = password.replace("\\", "\\\\").replace('"', '\\"')
    return '[client]\nuser=' + user + '\npassword="' + escaped + '"\nhost=127.0.0.1\n'


def create_secrets(directory, supplied=None):
    directory = private_location(directory)
    values = supplied or {
        "spring.datasource.password": secrets.token_urlsafe(48),
        "mysql_root_password": secrets.token_urlsafe(48),
        "posegood.internal-token": secrets.token_urlsafe(48),
    }
    if set(values) != set(SECRET_NAMES[:3]):
        raise ValueError("Exactly the database, root database and internal-service secrets are required")
    values = {name: secret_value(value, name) for name, value in values.items()}
    values["mysql-backup.cnf"] = mysql_options("root", values["mysql_root_password"])
    values["mysql-app.cnf"] = mysql_options("posegood", values["spring.datasource.password"])
    if directory.exists():
        if not directory.is_dir() or any(not (directory / name).is_file() for name in SECRET_NAMES):
            raise ValueError("Secret directory is incomplete; refusing to rotate or replace existing values")
        if os.name != "nt" and directory.stat().st_mode & 0o077:
            raise ValueError("Secret directory must be private (chmod 700)")
        existing = {name: secret_value((directory / name).read_text(), name) for name in SECRET_NAMES[:3]}
        if ((directory / "mysql-backup.cnf").read_text() != mysql_options("root", existing["mysql_root_password"])
                or (directory / "mysql-app.cnf").read_text() != mysql_options("posegood", existing["spring.datasource.password"])):
            raise ValueError("MySQL secret option files do not match the supplied password files")
        if supplied is not None and any((directory / name).read_text() != value for name, value in values.items()):
            raise ValueError("Existing deployment secrets differ; explicit coordinated rotation is required")
        return directory
    directory.parent.mkdir(parents=True, exist_ok=True)
    directory.mkdir(mode=0o700)
    created = []
    try:
        for name, value in values.items():
            with (directory / name).open("x", encoding="utf-8") as handle:
                created.append(directory / name)
                handle.write(value)
            # The private parent protects the host. File readability is required for
            # non-root container users because local Compose file secrets use bind mounts.
            if os.name != "nt":
                os.chmod(directory / name, 0o444)
    except Exception:
        for child in created:
            child.unlink()
        if not any(directory.iterdir()):
            directory.rmdir()
        raise
    return directory
