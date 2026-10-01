"""Prepare a participant-separated v2 dataset; does not train or tune any model."""

import argparse
from pathlib import Path

if __package__:
    from .dataset import prepare_dataset
else:
    from dataset import prepare_dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = prepare_dataset(args.config, args.output)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Dataset preparation rejected: {error}\n")
    counts = manifest["window_counts"]
    print(f"Prepared observed windows: train={counts.get('train', 0)}, validation={counts.get('validation', 0)}, test={counts.get('test', 0)}")
    print("Calibration is separate; no transforms fitted or model trained. Output contains private metadata.")


if __name__ == "__main__":
    main()
