"""Versioned local artifact loading; only use trusted joblib files."""

import hashlib
import json

import joblib

from model.analysis.replay_pilot.replay import private_destination


REPORT_SCHEMA = "replay-frame-two-stage-rf-pilot-v1"
CORRECTOR_FILE = "frame-corrector.joblib"
CLASSIFIER_FILE = "frame-posture.joblib"


def load_models(directory):
    """Load only locally trusted frame candidates matching both report hashes."""
    directory = private_destination(directory)
    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    if report.get("schema_version") != REPORT_SCHEMA or report.get("settings", {}).get("input") != "one_frame":
        raise ValueError("expected a two-stage single-frame RF report")
    hashes = report.get("model_artifact_sha256", {})
    for name in (CORRECTOR_FILE, CLASSIFIER_FILE):
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != hashes.get(name):
            raise ValueError("frame model does not match report")
    return joblib.load(directory / CORRECTOR_FILE), joblib.load(directory / CLASSIFIER_FILE), report


def load_predictor(directory, reference):
    """Restore the quality policy used for this candidate's training."""
    from .inference import FramePredictor
    corrector, classifier, report = load_models(directory)
    predictor = FramePredictor(corrector, classifier, reference,
                               min_visibility=report["settings"]["visibility_minimum"])
    return predictor, report
