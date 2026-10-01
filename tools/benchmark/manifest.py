"""Reproducibility metadata from allowlisted source/config paths and nonidentifying runtime facts."""

import hashlib
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from ..runtime import ROOT, java_executable, service_jar


SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".java", ".epl", ".css", ".xml", ".yml", ".yaml", ".sh"}
SOURCE_ROOTS = ("tools/", "tests/", "frontend/src/", "backend/", "model/prototype/", "model/inference/", "model/analysis/", ".github/workflows/")
EXCLUDED_PARTS = {".git", ".cache", ".venv", "node_modules", "target", "dist", "coverage", "__pycache__", "private", "datasets", "participants", "recordings", "captures", "weights", "secrets", "temp"}
ROOT_CONFIGS = {"Makefile", ".editorconfig", "requirements-dev.txt"}
FRONTEND_CONFIGS = {"frontend/package.json", "frontend/package-lock.json", "frontend/tsconfig.json", "frontend/tsconfig.app.json", "frontend/tsconfig.node.json", "frontend/vite.config.ts"}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def is_source_path(name):
    """Reject data/doc/private paths before opening or diffing any file."""
    path = Path(name)
    if path.is_absolute() or ".." in path.parts:
        return False
    if any(part.lower() in EXCLUDED_PARTS for part in path.parts):
        return False
    if name in ROOT_CONFIGS or name in FRONTEND_CONFIGS:
        return True
    if name.startswith(SOURCE_ROOTS) and path.suffix in SOURCE_SUFFIXES:
        return True
    if name.startswith(SOURCE_ROOTS) and path.name == "requirements.txt":
        return True
    if name.startswith("backend/") and path.name == "application.properties":
        return True
    if name.startswith("contracts/") and name.endswith(".schema.json"):
        return True
    return name.startswith("contracts/examples/") and (
        path.name.startswith("synthetic-") or path.name == "reference-feature-cases.json"
    ) and path.suffix == ".json"


def git_bytes(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL, timeout=10)


def source_revision(root=ROOT):
    head = git_bytes(root, "rev-parse", "HEAD").decode("ascii").strip()
    head_paths = git_bytes(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").decode("utf-8").split("\0")
    index_paths = git_bytes(root, "ls-files", "--cached", "-z").decode("utf-8").split("\0")
    eligible = sorted(name for name in set(head_paths + index_paths) if name and is_source_path(name))
    changed = git_bytes(root, "diff", "--name-only", "-z", "HEAD", "--", *eligible).decode("utf-8").split("\0") if eligible else []
    untracked = git_bytes(root, "ls-files", "--others", "--exclude-standard", "-z").decode("utf-8").split("\0")
    tracked_sources = sorted(name for name in changed if name and is_source_path(name))
    new_sources = []
    for name in sorted(name for name in untracked if name and is_source_path(name)):
        path = root / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            continue
        new_sources.append({"path": name, "sha256": sha256(path.read_bytes())})
    patch = git_bytes(root, "diff", "--binary", "--no-ext-diff", "HEAD", "--", *tracked_sources) if tracked_sources else b""
    encoded_new = json.dumps(new_sources, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "head": head,
        "dirty_source_patch_sha256": sha256(patch + b"\0untracked-source-hashes\0" + encoded_new),
        "hash_method": "allowlisted git diff --binary HEAD plus sorted path/SHA256 of untracked source",
        "tracked_dirty_source_count": len(tracked_sources),
        "untracked_source_count": len(new_sources),
        "untracked_sources": new_sources,
        "scope": "source/config/contracts only; docs, private/data directories, ignored artifacts and symlinks are excluded",
    }


def command_version(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
        return (result.stdout + result.stderr).strip()[:1000] if result.returncode == 0 else "unavailable"
    except (OSError, subprocess.SubprocessError):
        return "unavailable"


def runtime_manifest():
    return {
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "node": command_version(["node", "--version"]),
        "jdk": command_version([java_executable(), "-version"]),
        "os": {"system": platform.system(), "release": platform.release(), "architecture": platform.machine()},
        "device": {"logical_cpu_count": os.cpu_count()},
        "excluded_identifiers": ["hostname", "username", "serial number", "network addresses"],
    }


def artifact_hashes():
    return {
        component: sha256(service_jar(component, artifact).read_bytes())
        for component, artifact in (("api", "session-api"), ("cep", "cep-service"))
    }
