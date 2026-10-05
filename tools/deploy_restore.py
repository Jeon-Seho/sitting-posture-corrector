"""Restore a private backup into a separate empty Compose MySQL database only."""

import argparse
from pathlib import Path

from deploy.compose import environment, require_daemon
from deploy.restore import restore_database
from deploy.secrets import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Explicit empty recovery project; no production default")
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".cache/compose/secrets")
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    require_daemon()
    restore_database(args.project, args.input, environment(args.secrets_dir))
    print("Backup restored into the empty database. No existing schema or volume was deleted.")


if __name__ == "__main__":
    main()
