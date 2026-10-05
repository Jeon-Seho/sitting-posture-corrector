"""Deploy an already verified digest manifest through pinned SSH."""

import argparse
import json
import os
from pathlib import Path

from deploy.ssh import deploy_over_ssh


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    deploy_over_ssh(json.loads(args.manifest.read_text()), os.environ)
    print("Remote Compose release completed using immutable image digests.")


if __name__ == "__main__":
    main()
