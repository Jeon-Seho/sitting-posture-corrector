"""Validate untrusted workflow inputs before building SSH commands or file paths."""

import os
import re
from dataclasses import dataclass


SERVICES = ("api", "cep", "inference", "frontend")
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
DIGEST_IMAGE = re.compile(r"ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}")


def required(settings, name):
    value = settings.get(name, "")
    if not isinstance(value, str) or not value:
        raise ValueError("Missing required deployment setting: " + name)
    return value


def release_sha(value):
    if not SHA_PATTERN.fullmatch(value):
        raise ValueError("Release must be a full lowercase Git commit SHA")
    return value


def validate_manifest(document):
    if not isinstance(document, dict) or set(document) != {"schema_version", "git_sha", "images"}:
        raise ValueError("Deployment image manifest fields are invalid")
    if document["schema_version"] != "posegood-images-v1":
        raise ValueError("Unsupported deployment image manifest")
    release_sha(document["git_sha"])
    if not isinstance(document["images"], dict) or set(document["images"]) != set(SERVICES):
        raise ValueError("Exactly the four application image digests are required")
    for image in document["images"].values():
        if not isinstance(image, str) or not DIGEST_IMAGE.fullmatch(image):
            raise ValueError("Every deployment image must use a GHCR SHA-256 digest")
    return document


@dataclass(frozen=True)
class SSHSettings:
    host: str
    port: int
    user: str
    directory: str
    fingerprint: str


def ssh_settings(settings=None):
    settings = os.environ if settings is None else settings
    host = required(settings, "DEPLOY_HOST")
    user = required(settings, "DEPLOY_USER")
    directory = required(settings, "DEPLOY_DIRECTORY")
    port_text = required(settings, "DEPLOY_PORT")
    fingerprint = required(settings, "DEPLOY_HOST_FINGERPRINT")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host):
        raise ValueError("DEPLOY_HOST must be a hostname or IPv4 address without shell syntax")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user):
        raise ValueError("DEPLOY_USER must be an ordinary SSH account name")
    if not re.fullmatch(r"/[A-Za-z0-9_/-]+", directory) or ".." in directory.split("/") or directory == "/":
        raise ValueError("DEPLOY_DIRECTORY must be a dedicated absolute path without shell syntax")
    if not port_text.isdecimal() or not 1 <= int(port_text) <= 65535:
        raise ValueError("DEPLOY_PORT must be an explicit TCP port")
    if not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", fingerprint):
        raise ValueError("DEPLOY_HOST_FINGERPRINT must be an independently verified OpenSSH SHA256 fingerprint")
    return SSHSettings(host, int(port_text), user, directory.rstrip("/"), fingerprint)
