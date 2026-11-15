"""Catalog v8 data or train a participant-held-out single-frame RF pilot."""

import argparse
import json
import subprocess
import sys

from model.analysis.replay_pilot.replay import private_destination

from .frames import MIN_VISIBILITY
from .replay import load_catalog, make_catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog")
    catalog.add_argument("--input", required=True)
    catalog.add_argument("--output", required=True, help="new private catalog outside Git")
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--catalog", required=True)
    evaluate.add_argument("--output", required=True, help="new private output directory outside Git")
    evaluate.add_argument("--revision", help="full Git commit recorded in the report")
    evaluate.add_argument("--allow-unverified-identities", action="store_true")
    evaluate.add_argument("--candidate-only", action="store_true",
                          help="fixed configuration; train on all groups with no evaluation or threshold selection")
    evaluate.add_argument("--min-visibility", type=float, default=MIN_VISIBILITY,
                          help="experimental minimum for all nine model points")
    evaluate.add_argument("--classifier-trees", type=int, help="override classifier tree count for exploration")
    evaluate.add_argument("--corrector-trees", type=int, help="override corrector tree count for exploration")
    args = parser.parse_args()
    try:
        if args.command == "catalog":
            output = private_destination(args.output)
            data = make_catalog(args.input)
            with output.open("x", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            print(f"Catalog created: {len(data['captures'])} captures. Identity review required.")
        else:
            from .train import CONFIGS, CORRECTOR_CONFIG, candidate_only, experiment, save
            output = private_destination(args.output)
            if output.exists():
                raise ValueError("output must not exist")
            catalog, loaded = load_catalog(args.catalog, args.allow_unverified_identities)
            revision = args.revision
            if revision is not None and (len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision)):
                raise ValueError("revision must be a full lowercase Git commit")
            if revision is None:
                try:
                    revision = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                                              text=True, check=True).stdout.strip()
                except (OSError, subprocess.CalledProcessError):
                    revision = "unknown"
            if any(value is not None and value <= 0 for value in (args.classifier_trees, args.corrector_trees)):
                raise ValueError("tree counts must be positive")
            configs = tuple({**config, **({"n_estimators": args.classifier_trees}
                                         if args.classifier_trees is not None else {})} for config in CONFIGS)
            corrector_config = {**CORRECTOR_CONFIG, **({"n_estimators": args.corrector_trees}
                                                       if args.corrector_trees is not None else {})}
            if args.candidate_only:
                report, corrector, classifier = candidate_only(
                    loaded, catalog.get("identity_reviewed") is True, revision,
                    min_visibility=args.min_visibility, config=configs[1], corrector_config=corrector_config)
            else:
                report, corrector, classifier = experiment(
                    loaded, catalog.get("identity_reviewed") is True, revision,
                    min_visibility=args.min_visibility, configs=configs, corrector_config=corrector_config)
            save(output, report, corrector, classifier)
            print(f"Exploratory frame RF: {report['participants']} participant groups; "
                  f"identity_reviewed={report['identity_reviewed']}.")
            if args.candidate_only:
                print("No participant evaluation or threshold selection; 0.5 is a display placeholder.")
            else:
                print(f"Held-out participant mean balanced accuracy: "
                      f"{report['summary']['participant_mean_frame_balanced_accuracy']:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        # Input paths and participant names are private.
        print(f"Frame RF pilot failed: {type(exc).__name__}. Check the private input and output.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
