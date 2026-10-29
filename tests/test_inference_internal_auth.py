"""Representative service authentication with one synthetic v2 request."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from model.inference.app import create_app


class InferenceInternalAuthTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="posegood-internal-auth-test-")
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "synthetic-secret"
        self.token = "synthetic-internal-test-credential-00000000000000000000"
        path.write_text(self.token, encoding="ascii")
        with patch.dict(os.environ, {"POSEGOOD_INTERNAL_TOKEN_FILE": str(path), "POSEGOOD_REQUIRE_INTERNAL_TOKEN": "true"}):
            self.client = TestClient(create_app())
        example = Path(__file__).resolve().parents[1] / "contracts/examples/v2/synthetic-feature-request.json"
        self.body = json.loads(example.read_text(encoding="utf-8"))

    def test_valid_token_allows_v2_inference(self):
        response = self.client.post("/v2/infer", json=self.body, headers={"X-PoseGood-Internal-Token": self.token})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["valid"])

    def test_missing_token_is_rejected(self):
        response = self.client.post("/v2/infer", json=self.body)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"error": "unauthorized_internal_call"})

    def test_wrong_token_is_rejected(self):
        response = self.client.post("/v2/infer", json=self.body, headers={"X-PoseGood-Internal-Token": "wrong-synthetic-token"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"error": "unauthorized_internal_call"})


if __name__ == "__main__":
    unittest.main()
