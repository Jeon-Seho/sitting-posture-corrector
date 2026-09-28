"""Offline contract validation for synthetic fixtures and future consumer tests."""

import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "contracts/posture-status.v1.schema.json"


def reject_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=reject_constant)


def ensure_finite(value):
    # Also reject overflowed JSON exponents such as 1e999 and programmatic NaN.
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Non-finite number in contract payload")
    if isinstance(value, dict):
        for item in value.values():
            ensure_finite(item)
    elif isinstance(value, list):
        for item in value:
            ensure_finite(item)


def make_validator():
    schema = read_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_payload(payload):
    ensure_finite(payload)
    make_validator().validate(payload)
