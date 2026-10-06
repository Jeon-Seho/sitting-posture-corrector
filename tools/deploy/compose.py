"""Bounded Compose subprocesses; each caller chooses its own project."""

import os
import json
import re
import shutil
import subprocess
from pathlib import Path

from .secrets import ROOT

# Schema V1.1 (database/schema) creates and names the service database.
DATABASE = "posture_service"


def docker_executable():
    binary = shutil.which("docker")
    if not binary:
        raise RuntimeError("Docker CLI and Compose are required; install/start Docker before running this command")
    return binary


def command(project, root=ROOT):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise ValueError("Compose project name must be an explicit lowercase identifier")
    return [docker_executable(), "compose", "--project-name", project, "--file", str(Path(root) / "compose.yaml")]


def environment(secrets_dir, port=None, images=None):
    result = os.environ.copy()
    result["POSEGOOD_SECRETS_DIR"] = str(Path(secrets_dir).resolve())
    result["POSEGOOD_BIND_ADDRESS"] = "127.0.0.1"
    if port is not None:
        result["POSEGOOD_HTTP_PORT"] = str(port)
    for service, reference in (images or {}).items():
        result["POSEGOOD_" + service.upper() + "_IMAGE"] = reference
    return result


def run(project, *arguments, root=ROOT, env=None, timeout=600, capture=False):
    return subprocess.run(
        command(project, root) + list(arguments), cwd=root, env=env,
        check=True, timeout=timeout, capture_output=capture, text=True,
    )


def require_daemon():
    result = subprocess.run(
        [docker_executable(), "info", "--format", "{{.ServerVersion}}"],
        capture_output=True, text=True, timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError("Docker daemon is unavailable; start Docker Desktop or the Docker service")
    return result.stdout.strip()


def assert_project_removed(project, env):
    """Check labels on resources belonging to this exact, disposable project."""
    # Validate the project before it becomes a Docker label filter.
    binary = command(project)[0]
    label = "label=com.docker.compose.project=" + project
    resources = (
        ("containers", ["ps", "--all", "--quiet"]),
        ("networks", ["network", "ls", "--quiet"]),
        ("volumes", ["volume", "ls", "--quiet"]),
    )
    for name, arguments in resources:
        result = subprocess.run(
            [binary] + arguments + ["--filter", label],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.stdout.strip():
            raise AssertionError("Verification project still owns Docker " + name)


def loopback_publication(project, service, port, env):
    """Read the actual Engine binding, independently of Compose's port formatter."""
    container = run(project, "ps", "--quiet", service, env=env, capture=True, timeout=20).stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{12,64}", container):
        raise ValueError("Verification requires exactly one running " + service + " container")
    result = subprocess.run(
        [docker_executable(), "inspect", "--format", "{{json .NetworkSettings.Ports}}", container],
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    bindings = json.loads(result.stdout).get(str(port) + "/tcp") or []
    if len(bindings) != 1 or bindings[0].get("HostIp") != "127.0.0.1":
        raise ValueError("Disposable verification MySQL must expose exactly one loopback binding")
    published = bindings[0].get("HostPort", "")
    if not re.fullmatch(r"[0-9]+", published) or not 1 <= int(published) <= 65535:
        raise ValueError("Disposable verification MySQL has no valid actual published port")
    return "127.0.0.1:" + published
