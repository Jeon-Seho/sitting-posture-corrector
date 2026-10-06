"""Service authentication uses generated test credentials and synthetic requests."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from model.inference.app import create_app
from model.inference.internal_auth import load_internal_token


class InferenceInternalAuthTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="posegood-internal-auth-test-")
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "synthetic-secret"
        self.token = "synthetic-internal-test-credential-00000000000000000000"
        self.path.write_text(self.token + "\n", encoding="ascii")
        self.environment = {
            "POSEGOOD_INTERNAL_TOKEN_FILE": str(self.path),
            "POSEGOOD_REQUIRE_INTERNAL_TOKEN": "true",
        }
        with patch.dict(os.environ, self.environment):
            self.client = TestClient(create_app())
        self.body = {
            "schema_version": "1.0", "sequence": 0, "start_ms": 0, "end_ms": 1000,
            "phase": "running", "measurement_quality": "good",
            "features": {"forward_delta": .9, "lateral_delta": .1},
        }

    def test_health_is_public_but_inference_and_documentation_require_service_auth(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        for path in ("/v1/infer", "/v2/infer", "/docs", "/openapi.json"):
            with self.subTest(path=path):
                response = self.client.post(path, json=self.body)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"error": "unauthorized_internal_call"})

    def test_valid_token_keeps_existing_contract_and_invalid_token_is_not_reflected(self):
        headers = {"X-PoseGood-Internal-Token": self.token}
        response = self.client.post("/v1/infer", json=self.body, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["collapse_probability"], .9)
        for token in ("wrong-synthetic-token", self.token + "x", ""):
            with self.subTest(token=token):
                response = self.client.post(
                    "/v1/infer", json=self.body,
                    headers={"X-PoseGood-Internal-Token": token},
                )
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"error": "unauthorized_internal_call"})

    def test_duplicate_credentials_and_bad_body_are_rejected_before_input_validation(self):
        response = self.client.post(
            "/v1/infer", content="synthetic-invalid-json",
            headers=[("X-PoseGood-Internal-Token", self.token)] * 2,
        )
        self.assertEqual(response.status_code, 401)
        response = self.client.post("/v1/infer", content="synthetic-invalid-json")
        self.assertEqual(response.status_code, 401)

    def test_mandatory_secret_missing_or_invalid_fails_without_disclosing_contents(self):
        with self.assertRaises(ValueError):
            load_internal_token({"POSEGOOD_REQUIRE_INTERNAL_TOKEN": "true"})
        with self.assertRaises(ValueError):
            load_internal_token({"POSEGOOD_REQUIRE_INTERNAL_TOKEN": "maybe"})
        self.path.unlink()
        with self.assertRaises(ValueError):
            load_internal_token(self.environment)
        for contents in (b"", b"short", b"x" * 513, b"x" * 32 + b" ", b"x" * 32 + b"\x00"):
            self.path.write_bytes(contents)
            with self.subTest(length=len(contents)), self.assertRaises(ValueError) as error:
                load_internal_token(self.environment)
            self.assertEqual(str(error.exception), "invalid inference internal authentication secret")

    def test_local_development_can_run_without_a_secret(self):
        self.assertIsNone(load_internal_token({}))
        with patch.dict(os.environ, {}, clear=True):
            client = TestClient(create_app())
        self.assertEqual(client.post("/v1/infer", json=self.body).status_code, 200)

    def test_secret_length_boundaries_allow_a_normal_file_line_ending(self):
        for length in (32, 512):
            for ending in (b"", b"\n", b"\r\n"):
                with self.subTest(length=length, ending=ending):
                    token = b"x" * length
                    self.path.write_bytes(token + ending)
                    self.assertEqual(load_internal_token(self.environment), token)


if __name__ == "__main__":
    unittest.main()
