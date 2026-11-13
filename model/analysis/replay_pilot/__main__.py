"""CLI: catalog private replays, then run a grouped offline pilot."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

from .replay import load_catalog, make_catalog, private_destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog")
    catalog.add_argument("--input", required=True, help="private v8 replay directory")
    catalog.add_argument("--output", required=True, help="new private catalog JSON outside Git")
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--catalog", required=True)
    evaluate.add_argument("--output", required=True, help="new private output directory outside Git")
    evaluate.add_argument("--revision", help="repository commit recorded in the experiment report")
    evaluate.add_argument("--allow-unverified-identities", action="store_true",
                          help="label results exploratory when identity mapping is not reviewed")
    args = parser.parse_args()
    try:
        if args.command == "catalog":
            output = private_destination(args.output)
            data = make_catalog(args.input)
            with output.open("x", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            print(f"Catalog created: {len(data['captures'])} captures, {len(set(data['name_to_id'].values()))} provisional participants. Identity review required.")
        else:
            from .evaluate import experiment, write_outputs
            output = private_destination(args.output)
            catalog, loaded = load_catalog(args.catalog, args.allow_unverified_identities)
            revision = args.revision
            if revision is not None and (len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision)):
                raise ValueError("revision must be a full lowercase Git commit")
            if revision is None:
                try:
                    revision = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
                except (OSError, subprocess.CalledProcessError):
                    revision = "unknown"
            report, models = experiment(loaded, catalog.get("identity_reviewed") is True, revision)
            write_outputs(output, report, models)
            print(f"Exploratory report completed for {report['participants']} participant groups; identity_reviewed={report['identity_reviewed']}.")
            for name, result in report["summary"].items():
                print(f"{name}: participant mean balanced accuracy {result['participant_mean_window_balanced_accuracy']:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        # Avoid printing file names or participant identities from private paths.
        print(f"Replay pilot failed: {type(exc).__name__}. Check the private catalog and input data.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
