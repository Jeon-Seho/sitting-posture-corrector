"""Apply one verified release on a Docker/Compose SSH host."""

import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .backup import backup_database
from .compose import environment, require_daemon, run
from .config import validate_manifest
from .secrets import create_secrets


def atomic_json(path, document):
    descriptor, name = tempfile.mkstemp(prefix=".release-manifest-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(document, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def deployment_lock(path):
    try:
        import fcntl
    except ImportError:
        raise RuntimeError("SSH deployment requires a Linux/POSIX host with file locking") from None
    with path.open("a") as handle:
        os.chmod(path, 0o600)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another deployment is currently running") from None
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def apply_release(directory, sha, payload, *, schema_compatible=False):
    release = directory / "releases" / sha
    manifest = validate_manifest(json.loads((release / "images.json").read_text()))
    if manifest["git_sha"] != sha:
        raise ValueError("Release directory and image manifest commit do not match")
    shared = directory / "shared"
    shared.mkdir(mode=0o700, exist_ok=True)
    if os.name != "nt" and shared.stat().st_mode & 0o077:
        raise ValueError("Deployment shared directory must be private (chmod 700)")
    with deployment_lock(shared / "deployment.lock"):
        require_daemon()
        secret_directory = create_secrets(shared / "secrets", payload["secrets"])
        env = environment(secret_directory, images=manifest["images"])
        # Remote production requires a host TLS reverse proxy in front of loopback NGINX.
        env["POSEGOOD_COOKIE_SECURE"] = "true"
        project = "posegood"
        current = shared / "current.json"
        existing = None
        if current.exists():
            existing = validate_manifest(json.loads(current.read_text()))
            if existing["git_sha"] == sha:
                print("Release already active; verifying it without replacing the volume.")
            elif schema_compatible:
                print("Operator confirmed schema compatibility for image rollback.")
        with tempfile.TemporaryDirectory(prefix="registry-", dir=shared) as temporary:
            env["DOCKER_CONFIG"] = temporary
            import subprocess
            subprocess.run(
                ["docker", "login", "ghcr.io", "--username", payload["registry_user"], "--password-stdin"],
                input=payload["registry_token"], text=True, env=env,
                check=True, capture_output=True, timeout=30,
            )
            run(project, "pull", root=release, env=env, timeout=600)
            run(project, "up", "--no-build", "--wait", "--wait-timeout", "120", "db", root=release, env=env)
            # A previous process may have stopped before recording current.json;
            # the database is authoritative, so every migration attempt receives a backup.
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup_database(project, shared / "backups" / (timestamp + ".sql.gz"), env, root=release)
            # The API verifies schema V1.1 at startup; it never migrates. Volumes are never removed.
            run(project, "up", "--no-build", "--wait", "--wait-timeout", "180", root=release, env=env)
        if existing is not None and existing != manifest:
            atomic_json(shared / "previous.json", existing)
        atomic_json(current, manifest)
    return manifest
