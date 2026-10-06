"""Train an explicitly configured, local single-person feasibility baseline."""

import argparse
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from model.analysis.personal.run import run_experiment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run_experiment(args.config, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Personal experiment failed: {error}\n")
    print(f"Personal experiment complete; selected={report['selected_model']}; holdout windows={report['holdout']['windows']}")
    print(args.output / "report.md")
    print("Same-person capture check only; no cross-person or production accuracy claim.")


if __name__ == "__main__":
    main()
