"""Package and relocate a private, resumable 100-view frame RF experiment.

The bundle contains real recordings, names, and joblib files. Keep it outside
Git and use it only from a trusted source; joblib loading can execute code.
"""

import argparse
import hashlib
import itertools
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from model.analysis.replay_pilot.replay import private_destination  # noqa: E402


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
    path.chmod(0o600)


def copy_private(source, destination):
    destination = Path(destination)
    shutil.copyfile(source, destination)
    destination.chmod(0o600)


def pack(catalog_path, prior_dir, checkpoint_dir, destination):
    """Copy only catalog-listed captures and trusted experiment artifacts."""
    catalog_path, prior_dir = Path(catalog_path), private_destination(prior_dir)
    checkpoint_dir, destination = private_destination(checkpoint_dir), private_destination(destination)
    if destination.exists():
        raise ValueError("bundle directory already exists")
    catalog, prior = read_json(catalog_path), read_json(prior_dir / "report.json")
    if prior.get("catalog_sha256") != sha256(catalog_path):
        raise ValueError("prior catalog does not match")
    captures = catalog.get("captures", [])
    if not captures or sorted(row["sha256"] for row in captures) != prior.get("input_sha256"):
        raise ValueError("capture list does not match prior evaluation")
    for name in ("frame-corrector.joblib", "frame-posture.joblib"):
        if sha256(prior_dir / name) != prior.get("model_artifact_sha256", {}).get(name):
            raise ValueError("prior model integrity mismatch")
    manifest = read_json(checkpoint_dir / "checkpoint.json")
    if manifest.get("schema_version") != "frame-rf-checkpoint-v1":
        raise ValueError("checkpoint schema mismatch")
    for path in checkpoint_dir.glob("*.joblib"):
        if sha256(path) != path.with_suffix(".sha256").read_text(encoding="ascii").strip():
            raise ValueError("checkpoint integrity mismatch")
    destination.mkdir(mode=0o700)
    try:
        (destination / "captures").mkdir(mode=0o700)
        (destination / "prior").mkdir(mode=0o700)
        (destination / "checkpoint").mkdir(mode=0o700)
        copy_private(catalog_path, destination / "catalog.json")
        for row in captures:
            source, digest = Path(row["path"]), row["sha256"]
            if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest) or sha256(source) != digest:
                raise ValueError("capture integrity mismatch")
            copy_private(source, destination / "captures" / (digest + ".json"))
        for name in ("report.json", "frame-corrector.joblib", "frame-posture.joblib", "coverage.json"):
            source = prior_dir / name
            if source.exists():
                copy_private(source, destination / "prior" / name)
        for source in checkpoint_dir.iterdir():
            if source.is_file() and source.suffix in (".json", ".joblib", ".sha256"):
                copy_private(source, destination / "checkpoint" / source.name)
        files = {str(path.relative_to(destination)): sha256(path)
                 for path in sorted(destination.rglob("*")) if path.is_file()}
        write_json(destination / "bundle.json", {"schema_version": "frame-rf-private-bundle-v1", "files": files})
    except Exception:
        shutil.rmtree(destination)
        raise
    return len(captures), len(list((destination / "checkpoint").glob("*.joblib")))


def check_bundle(bundle):
    bundle = private_destination(bundle)
    manifest = read_json(bundle / "bundle.json")
    if manifest.get("schema_version") != "frame-rf-private-bundle-v1" or not manifest.get("files"):
        raise ValueError("invalid bundle manifest")
    for name, digest in manifest["files"].items():
        path = (bundle / name).resolve()
        path.relative_to(bundle)
        if not path.is_file() or sha256(path) != digest:
            raise ValueError("bundle file integrity mismatch")
    return bundle


def fingerprint(catalog_hash, report_hash, identity_reviewed):
    import joblib
    import numpy as np
    import sklearn
    from model.analysis.frame_pilot.holdout_100 import current_hashes
    data = {"catalog_sha256": catalog_hash, "prior_report_sha256": report_hash,
            "code_sha256": current_hashes(), "identity_reviewed": identity_reviewed,
            "python": sys.version.split()[0], "numpy": np.__version__,
            "scikit_learn": sklearn.__version__, "joblib": joblib.__version__}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def prepare(bundle, session):
    """Relocate paths while checking that code, input bytes and models are unchanged."""
    from model.analysis.frame_pilot.artifacts import load_models
    from model.analysis.frame_pilot.checkpoint import Checkpoint
    from model.analysis.frame_pilot.holdout_100 import verify_model, verify_prior
    from model.analysis.frame_pilot.replay import load_catalog

    bundle, session = check_bundle(bundle), private_destination(session)
    if session.exists():
        raise ValueError("session directory already exists")
    original_catalog = read_json(bundle / "catalog.json")
    prior_corrector, prior_classifier, prior = load_models(bundle / "prior")
    original_catalog_hash = sha256(bundle / "catalog.json")
    original_report_hash = sha256(bundle / "prior" / "report.json")
    if prior.get("catalog_sha256") != original_catalog_hash:
        raise ValueError("prior catalog mismatch")
    reviewed = original_catalog.get("identity_reviewed") is True
    old_fingerprint = fingerprint(original_catalog_hash, original_report_hash, reviewed)
    checkpoint = Checkpoint(bundle / "checkpoint", old_fingerprint)
    session.mkdir(mode=0o700)
    try:
        catalog = dict(original_catalog)
        catalog["captures"] = [{**row, "path": str((bundle / "captures" / (row["sha256"] + ".json")).resolve())}
                               for row in original_catalog["captures"]]
        write_json(session / "catalog.json", catalog)
        new_catalog_hash = sha256(session / "catalog.json")
        _, loaded = load_catalog(session / "catalog.json", allow_unverified=True)
        relocated_prior = dict(prior)
        relocated_prior["catalog_sha256"] = new_catalog_hash
        relocated_prior["catalog_relocation"] = {"original_catalog_sha256": original_catalog_hash,
                                                  "original_report_sha256": original_report_hash}
        verify_prior(relocated_prior, prior_corrector, prior_classifier, loaded, reviewed, new_catalog_hash)
        people = sorted({person for person, _, _ in loaded})
        excluded_sets = [*([person] for person in people), *map(list, itertools.combinations(people, 2))]
        for excluded in excluded_sets:
            model = checkpoint.load_model("corrector", sorted(excluded))
            if model is None:
                raise ValueError("required corrector checkpoint is missing")
            verify_model(model, prior["settings"]["corrector_config"], 7)
        (session / "prior").mkdir(mode=0o700)
        for name in ("frame-corrector.joblib", "frame-posture.joblib"):
            copy_private(bundle / "prior" / name, session / "prior" / name)
        write_json(session / "prior" / "report.json", relocated_prior)
        if (bundle / "prior" / "coverage.json").exists():
            coverage = read_json(bundle / "prior" / "coverage.json")
            coverage["original_catalog_sha256"] = coverage["catalog_sha256"]
            coverage["catalog_sha256"] = new_catalog_hash
            write_json(session / "prior" / "coverage.json", coverage)
        shutil.copytree(bundle / "checkpoint", session / "checkpoint")
        new_fingerprint = fingerprint(new_catalog_hash, sha256(session / "prior" / "report.json"), reviewed)
        (session / "checkpoint" / "checkpoint.json").unlink()
        write_json(session / "checkpoint" / "checkpoint.json",
                   {"schema_version": "frame-rf-checkpoint-v1", "fingerprint": new_fingerprint})
        Checkpoint(session / "checkpoint", new_fingerprint)
    except Exception:
        shutil.rmtree(session)
        raise
    return len(loaded), len(excluded_sets)


def run(session, workers):
    session = private_destination(session)
    command = [sys.executable, "-m", "model.analysis.frame_pilot.holdout_100",
               "--catalog", str(session / "catalog.json"), "--prior-dir", str(session / "prior"),
               "--checkpoint-dir", str(session / "checkpoint"), "--output", str(session / "result"),
               "--allow-unverified-identities", "--workers", str(workers)]
    env = dict(os.environ, OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1")
    return subprocess.run(command, cwd=ROOT, env=env, check=False).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    packing = commands.add_parser("pack")
    for name in ("catalog", "prior-dir", "checkpoint-dir", "output"):
        packing.add_argument("--" + name, required=True)
    preparing = commands.add_parser("prepare")
    preparing.add_argument("--bundle", required=True)
    preparing.add_argument("--session", required=True)
    running = commands.add_parser("run")
    running.add_argument("--session", required=True)
    running.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    try:
        if args.command == "pack":
            captures, models = pack(args.catalog, args.prior_dir, args.checkpoint_dir, args.output)
            print(f"Private bundle saved: {captures} captures, {models} checkpoint models.")
        elif args.command == "prepare":
            captures, models = prepare(args.bundle, args.session)
            print(f"Ready to resume: {captures} captures, {models} verified corrector models.")
        else:
            return run(args.session, args.workers)
    except (ValueError, KeyError, TypeError, OSError, ImportError) as exc:
        print(f"Resume preparation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
