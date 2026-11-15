"""Private, integrity-checked checkpoints for long local RF experiments.

Joblib can execute code: only resume checkpoints in a directory you trust.
"""

import hashlib
import json
import os
from pathlib import Path
import tempfile

import joblib

from model.analysis.replay_pilot.replay import private_destination


class Checkpoint:
    def __init__(self, directory, fingerprint):
        self.directory = private_destination(directory)
        if not isinstance(fingerprint, str) or len(fingerprint) != 64:
            raise ValueError("invalid checkpoint fingerprint")
        self.fingerprint = fingerprint
        created = False
        try:
            self.directory.mkdir(mode=0o700, parents=False, exist_ok=False)
            created = True
        except FileExistsError:
            pass
        manifest = self.directory / "checkpoint.json"
        expected = {"schema_version": "frame-rf-checkpoint-v1", "fingerprint": fingerprint}
        if created:
            self._atomic(manifest, lambda path: path.write_text(json.dumps(expected), encoding="utf-8"))
        elif not manifest.is_file() or json.loads(manifest.read_text(encoding="utf-8")) != expected:
            raise ValueError("checkpoint belongs to different data, code, or settings")

    def _atomic(self, destination, write):
        descriptor, name = tempfile.mkstemp(prefix=".frame-rf-", dir=self.directory)
        os.close(descriptor)
        temporary = Path(name)
        try:
            write(temporary)
            os.chmod(temporary, 0o600)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _paths(self, kind, key, suffix):
        token = hashlib.sha256(json.dumps([kind, key], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return self.directory / f"{token}.{suffix}", self.directory / f"{token}.sha256"

    def _read(self, kind, key, suffix, load):
        path, digest_path = self._paths(kind, key, suffix)
        if not path.exists() or not digest_path.exists():
            return None  # An interrupted partial write is safe to recompute.
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest_path.read_text(encoding="ascii").strip() != digest:
            raise ValueError("checkpoint integrity mismatch")
        return load(path)

    def _write(self, kind, key, suffix, write):
        path, digest_path = self._paths(kind, key, suffix)
        self._atomic(path, write)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        self._atomic(digest_path, lambda target: target.write_text(digest + "\n", encoding="ascii"))

    def load_model(self, kind, key):
        return self._read(kind, key, "joblib", joblib.load)

    def save_model(self, kind, key, model):
        self._write(kind, key, "joblib", lambda path: joblib.dump(model, path))

    def load_json(self, kind, key):
        return self._read(kind, key, "json", lambda path: json.loads(path.read_text(encoding="utf-8")))

    def save_json(self, kind, key, value):
        self._write(kind, key, "json", lambda path: path.write_text(
            json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8"))
