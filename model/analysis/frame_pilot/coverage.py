"""Count labeled frames and trials excluded before frame-RF inference."""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import sys

from model.analysis.replay_pilot.replay import private_destination

from .data import prepare_capture
from .frames import MIN_VISIBILITY
from .replay import load_catalog
from .train import _code_hashes


def coverage(loaded, identity_reviewed, *, min_visibility=MIN_VISIBILITY):
    """Aggregate counts only; never return source coordinates or participant names."""
    summaries = {task: Counter() for task in ("neutral", "deviation")}
    for person, digest, data in loaded:
        samples, diagnostics, _ = prepare_capture(person, digest[:16], data, min_visibility=min_visibility)
        usable = Counter(sample.trial for sample in samples)
        observed = Counter((frame["round"], frame["trial"], frame["task"], frame["attempt"], frame["segment"])
                           for frame in data["frames"] if frame["phase"] == "hold")
        for trial, total in observed.items():
            task = trial[2]
            if task not in summaries:
                raise ValueError("unsupported measurement task")
            valid = usable[trial]
            if valid > total:
                raise ValueError("usable frame count exceeds source frames")
            row = summaries[task]
            row["source_frames"] += total
            row["usable_frames"] += valid
            row["excluded_frames"] += total - valid
            row["trials"] += 1
            row["trials_without_usable_frames"] += int(valid == 0)
            row["trials_partly_excluded"] += int(0 < valid < total)
            row["trials_all_usable"] += int(valid == total)
        for task in summaries:
            prefix = f"excluded_{task}_"
            for key, count in diagnostics.items():
                if key.startswith(prefix):
                    summaries[task]["excluded_" + key[len(prefix):]] += count

    fields = ("source_frames", "usable_frames", "excluded_frames", "excluded_head_turn",
              "excluded_unmeasurable", "trials", "trials_without_usable_frames",
              "trials_partly_excluded", "trials_all_usable")
    for row in summaries.values():
        if row["excluded_frames"] != row["excluded_head_turn"] + row["excluded_unmeasurable"]:
            raise ValueError("unrecognized exclusion reason")
    sources = _code_hashes()
    sources["frame_pilot/coverage.py"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return {
        "schema_version": "replay-frame-eligibility-v1",
        "identity_reviewed": bool(identity_reviewed),
        "captures": len(loaded), "participant_groups": len({person for person, _, _ in loaded}),
        "input_sha256": sorted(digest for _, digest, _ in loaded),
        "code_sha256": sources, "visibility_minimum": min_visibility,
        "counts": {task: {field: row[field] for field in fields} for task, row in summaries.items()},
        "limitations": [
            "Coverage describes eligibility before model scoring, not prediction accuracy.",
            "Guided labels and participant identities may be unverified.",
            "Trials with no usable frames are absent from model-scored trial metrics.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--output", required=True, help="new private report outside Git")
    parser.add_argument("--allow-unverified-identities", action="store_true")
    parser.add_argument("--min-visibility", type=float, default=MIN_VISIBILITY)
    args = parser.parse_args()
    try:
        output = private_destination(args.output)
        if output.exists():
            raise ValueError("output must not exist")
        catalog_path = Path(args.catalog)
        catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        report = coverage(loaded, catalog.get("identity_reviewed") is True, min_visibility=args.min_visibility)
        if hashlib.sha256(catalog_path.read_bytes()).hexdigest() != catalog_hash:
            raise ValueError("catalog changed during coverage check")
        load_catalog(catalog_path, args.allow_unverified_identities)
        report["catalog_sha256"] = catalog_hash
        report["source_integrity_rechecked"] = True
        with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        print(json.dumps({"identity_reviewed": report["identity_reviewed"], "counts": report["counts"]},
                         ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Frame coverage failed: {type(exc).__name__}. Check the private inputs and settings.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
