"""Initialize private Compose secret files; never overwrite deployment secrets."""

import argparse
from pathlib import Path

from deploy.secrets import ROOT, create_secrets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--secrets-dir", type=Path, default=ROOT / ".cache/compose/secrets")
    args = parser.parse_args()
    create_secrets(args.secrets_dir)
    print("Compose secret files are ready. Values were not printed or added to the repository.")
    print("Start: docker compose up --build --wait --wait-timeout 180")


if __name__ == "__main__":
    main()
