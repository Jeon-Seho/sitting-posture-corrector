"""Create a private backup of the existing Compose MySQL database."""

import argparse
from pathlib import Path

from deploy.backup import backup_database
from deploy.compose import environment, require_daemon
from deploy.secrets import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="posegood")
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".cache/compose/secrets")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require_daemon()
    backup_database(args.project, args.output, environment(args.secrets_dir))
    print("Private MySQL backup completed; database volume was preserved.")


if __name__ == "__main__":
    main()
