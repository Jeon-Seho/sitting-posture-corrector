"""posture.frames.v1 draft (FE proposal 2.1), synthetic examples only."""

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "contracts" / "realtime" / "frames"


def load(name):
    return json.loads((FRAMES / name).read_text(encoding="utf-8"))


class FrameContractTests(unittest.TestCase):
    def setUp(self):
        schema = load("posture-frames.v1.schema.json")
        Draft202012Validator.check_schema(schema)
        self.validator = Draft202012Validator(schema)

    def test_examples_match(self):
        for name in ("example-running.json", "example-rest.json"):
            with self.subTest(example=name):
                self.validator.validate(load(name))

    def test_rejects_wrong_joint_count_unknown_fields_and_true_valid(self):
        base = load("example-running.json")
        bad = copy.deepcopy(base)
        bad["frames"][0]["p"] = bad["frames"][0]["p"][:8]
        with self.assertRaises(ValidationError):
            self.validator.validate(bad)
        extra = copy.deepcopy(base)
        extra["score"] = 0.5
        with self.assertRaises(ValidationError):
            self.validator.validate(extra)
        marked = copy.deepcopy(base)
        marked["frames"][0]["valid"] = True
        with self.assertRaises(ValidationError):
            self.validator.validate(marked)

    def test_camera_size_is_not_sent(self):
        # 640x480 is fixed (DB V2.3 CAPTURE_RESOLUTION, 10/15): the app does not send width/height.
        sized = load("example-running.json")
        sized.update(width=640, height=480)
        with self.assertRaises(ValidationError):
            self.validator.validate(sized)


if __name__ == "__main__":
    unittest.main()
