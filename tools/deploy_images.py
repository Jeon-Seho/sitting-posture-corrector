"""Build/publish application images for one commit and record immutable digests."""

import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

from deploy.config import SERVICES, release_sha, validate_manifest
from deploy.secrets import ROOT


DOCKERFILES = {
    "api": ("infra/docker/java.Dockerfile", "api"),
    "cep": ("infra/docker/java.Dockerfile", "cep"),
    "inference": ("infra/docker/inference.Dockerfile", None),
    "frontend": ("infra/docker/frontend.Dockerfile", None),
}


def build_command(service, repository, sha, metadata, platform):
    dockerfile, target = DOCKERFILES[service]
    command = [
        "docker", "buildx", "build", "--file", dockerfile,
        "--platform", platform, "--push", "--metadata-file", str(metadata),
        "--tag", "ghcr.io/" + repository + "-" + service + ":sha-" + sha,
        "--label", "org.opencontainers.image.revision=" + sha,
        "--label", "org.opencontainers.image.source=https://github.com/" + repository,
    ]
    if target:
        command.extend(["--target", target])
    return command + ["."]


def publish_images(repository, sha, output, platform):
    repository = repository.lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*", repository):
        raise ValueError("A GitHub owner/repository is required")
    release_sha(sha)
    if platform not in ("linux/amd64", "linux/arm64", "linux/amd64,linux/arm64"):
        raise ValueError("An explicit supported Linux image platform is required")
    images = {}
    with tempfile.TemporaryDirectory(prefix="posegood-image-metadata-") as temporary:
        for service in SERVICES:
            metadata = Path(temporary) / (service + ".json")
            subprocess.run(build_command(service, repository, sha, metadata, platform), cwd=ROOT, check=True)
            digest = json.loads(metadata.read_text())["containerimage.digest"]
            images[service] = "ghcr.io/" + repository + "-" + service + "@" + digest
    manifest = validate_manifest({"schema_version": "posegood-images-v1", "git_sha": sha, "images": images})
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publish", action="store_true", help="Required explicit authorization to push registry images")
    args = parser.parse_args()
    if not args.publish:
        parser.error("--publish is required; this command writes to GHCR")
    publish_images(args.repository, args.sha, args.output, args.platform)
    print("Four commit-tagged images published; deployment manifest contains immutable digests.")


if __name__ == "__main__":
    main()
