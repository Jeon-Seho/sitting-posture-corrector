"""Pinned SSH transport. Remote commands contain only validated fixed paths."""

import json
import os
import shlex
import subprocess
import tarfile
import tempfile
from pathlib import Path

from .config import required, ssh_settings, validate_manifest
from .secrets import ROOT, secret_value


def verify_known_host(settings, known_hosts, output):
    lines = [line for line in known_hosts.splitlines() if line and not line.startswith("#")]
    expected = settings.host if settings.port == 22 else "[" + settings.host + "]:" + str(settings.port)
    if len(lines) != 1 or len(lines[0].split()) != 3 or lines[0].split()[0] != expected:
        raise ValueError("DEPLOY_KNOWN_HOSTS must contain exactly the verified destination host key")
    output.write_text(lines[0] + "\n")
    os.chmod(output, 0o600)
    result = subprocess.run(["ssh-keygen", "-l", "-E", "sha256", "-f", str(output)], check=True, capture_output=True, text=True)
    if result.stdout.split()[1] != settings.fingerprint:
        raise ValueError("Pinned SSH host key does not match DEPLOY_HOST_FINGERPRINT")


def transport_options(settings, key, known_hosts):
    return [
        "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=15",
        "-o", "UserKnownHostsFile=" + str(known_hosts), "-i", str(key),
    ]


def bundle_release(destination, manifest):
    with tarfile.open(destination, "w:gz") as archive:
        archive.add(ROOT / "compose.yaml", arcname="compose.yaml")
        # Bind-mounted by the db service; applied only when the volume is empty.
        for folder in ("infra/mysql/initdb", "database/schema", "database/seed"):
            for path in sorted((ROOT / folder).iterdir()):
                if path.is_file():
                    archive.add(path, arcname=folder + "/" + path.name)
        archive.add(ROOT / "tools/deploy_host.py", arcname="tools/deploy_host.py")
        for path in sorted((ROOT / "tools/deploy").glob("*.py")):
            archive.add(path, arcname="tools/deploy/" + path.name)
        encoded = json.dumps(manifest).encode("utf-8")
        metadata = tarfile.TarInfo("images.json")
        metadata.size = len(encoded)
        import io
        archive.addfile(metadata, io.BytesIO(encoded))


def deploy_over_ssh(manifest, environment):
    manifest = validate_manifest(manifest)
    settings = ssh_settings(environment)
    payload = {
        "registry_user": required(environment, "GHCR_USERNAME"),
        "registry_token": required(environment, "GHCR_TOKEN"),
        "secrets": {
            "spring.datasource.password": secret_value(required(environment, "MYSQL_APP_PASSWORD"), "MYSQL_APP_PASSWORD"),
            "mysql_root_password": secret_value(required(environment, "MYSQL_ROOT_PASSWORD"), "MYSQL_ROOT_PASSWORD"),
            "posegood.internal-token": secret_value(required(environment, "POSEGOOD_INTERNAL_TOKEN"), "POSEGOOD_INTERNAL_TOKEN"),
        },
    }
    with tempfile.TemporaryDirectory(prefix="posegood-ssh-") as temporary:
        folder = Path(temporary)
        key, hosts, bundle = folder / "key", folder / "known_hosts", folder / "release.tar.gz"
        key.write_text(required(environment, "DEPLOY_SSH_KEY") + "\n")
        os.chmod(key, 0o600)
        verify_known_host(settings, required(environment, "DEPLOY_KNOWN_HOSTS"), hosts)
        bundle_release(bundle, manifest)
        destination = settings.user + "@" + settings.host
        options = transport_options(settings, key, hosts)
        incoming = settings.directory + "/incoming-" + manifest["git_sha"] + ".tar.gz"
        # No server address, branch name, password or token becomes executable remote code.
        subprocess.run(["ssh"] + options + ["-p", str(settings.port), destination, "mkdir", "-p", settings.directory], check=True, timeout=30)
        subprocess.run(["scp"] + options + ["-P", str(settings.port), str(bundle), destination + ":" + incoming], check=True, timeout=120)
        remote = " && ".join([
            "mkdir -p " + shlex.quote(settings.directory + "/releases/" + manifest["git_sha"]),
            "tar -xzf " + shlex.quote(incoming) + " -C " + shlex.quote(settings.directory + "/releases/" + manifest["git_sha"]),
            "python3 " + shlex.quote(settings.directory + "/releases/" + manifest["git_sha"] + "/tools/deploy_host.py") +
            " --directory " + shlex.quote(settings.directory) + " --release " + manifest["git_sha"],
        ])
        subprocess.run(
            ["ssh"] + options + ["-p", str(settings.port), destination, remote],
            input=json.dumps(payload), text=True, check=True, timeout=1800,
        )
