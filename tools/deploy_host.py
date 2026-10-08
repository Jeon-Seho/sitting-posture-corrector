"""Host entry called by pinned SSH; secret payload arrives over stdin only."""

import argparse
import json
import sys
from pathlib import Path

from deploy.config import release_sha
from deploy.host import apply_release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--schema-compatible-rollback", action="store_true")
    args = parser.parse_args()
    sha = release_sha(args.release)
    payload = json.load(sys.stdin)
    if set(payload) != {"registry_user", "registry_token", "secrets"}:
        raise ValueError("Deployment stdin payload fields are invalid")
    apply_release(args.directory.resolve(), sha, payload, schema_compatible=args.schema_compatible_rollback)
    print("Release healthy. Database volume preserved; current digest manifest recorded.")


if __name__ == "__main__":
    main()
