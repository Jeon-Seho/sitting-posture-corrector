"""Offline deployment safety regressions; live services are checked by compose_smoke."""

import gzip
import importlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools.deploy.backup import backup_database
from tools.deploy.config import ssh_settings, validate_manifest
from tools.deploy.secrets import ROOT, SECRET_NAMES, create_secrets, mysql_options
from tools.deploy.ssh import bundle_release, verify_known_host
from tools.deploy.restore import compose_rows, restore_database
from tools.deploy.host import apply_release, atomic_json, deployment_lock
from tools.deploy.compose import assert_project_removed, loopback_publication


def image_manifest():
    return {
        "schema_version": "posegood-images-v1", "git_sha": "a" * 40,
        "images": {name: "ghcr.io/example/synthetic-" + name + "@sha256:" + "b" * 64
                   for name in ("api", "cep", "inference", "frontend")},
    }


def settings():
    return {"DEPLOY_HOST": "synthetic.example.invalid", "DEPLOY_PORT": "22",
            "DEPLOY_USER": "deploy", "DEPLOY_DIRECTORY": "/opt/posegood",
            "DEPLOY_HOST_FINGERPRINT": "SHA256:" + "a" * 43}


class DeploymentConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="synthetic-deploy-tests-")
        self.folder = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_secret_initialization_is_idempotent_and_private_without_replacing_values(self):
        directory = create_secrets(self.folder / "secrets")
        original = {name: (directory / name).read_bytes() for name in SECRET_NAMES}
        create_secrets(directory)
        self.assertEqual(original, {name: (directory / name).read_bytes() for name in SECRET_NAMES})
        if os.name != "nt":
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all((directory / name).stat().st_mode & 0o777 == 0o444 for name in SECRET_NAMES))

    def test_secret_rotation_and_incomplete_existing_directory_are_explicitly_rejected(self):
        directory = create_secrets(self.folder / "secrets")
        original = (directory / "spring.datasource.password").read_text()
        with self.assertRaisesRegex(ValueError, "rotation"):
            create_secrets(directory, {name: "changed_" + "c" * 40 for name in SECRET_NAMES[:3]})
        self.assertEqual((directory / "spring.datasource.password").read_text(), original)
        (directory / "posegood.internal-token").unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            create_secrets(directory)
        self.assertEqual((directory / "spring.datasource.password").read_text(), original)

    def test_public_or_unignored_secret_directories_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Git-ignored"):
            create_secrets(ROOT / "unignored-deployment-unit-secrets")
        directory = create_secrets(self.folder / "secrets")
        if os.name != "nt":
            directory.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "private"):
                create_secrets(directory)

    def test_multiline_or_non_url_safe_internal_token_is_rejected_before_writing(self):
        for value in ("short", "a" * 32 + "\n", "a" * 32 + "+", "한" * 32):
            with self.subTest(value_kind=value[-1:]), self.assertRaises(ValueError):
                create_secrets(self.folder / "secrets", {
                    "spring.datasource.password": "a" * 40,
                    "mysql_root_password": "b" * 40, "posegood.internal-token": value,
                })
            self.assertFalse((self.folder / "secrets").exists())

    def test_mysql_option_file_quotes_password_metacharacters_without_command_arguments(self):
        password = 'synthetic-password-with-"quote"-and-\\-slashes'
        result = mysql_options("posegood", password)
        self.assertIn('password="synthetic-password-with-\\"quote\\"-and-\\\\-slashes"', result)
        self.assertEqual(result.splitlines()[0], "[client]")

    def test_release_requires_all_four_immutable_ghcr_digests(self):
        self.assertEqual(validate_manifest(image_manifest())["git_sha"], "a" * 40)
        for value in ("ghcr.io/example/api:latest", "ghcr.io/example/api:sha-" + "a" * 40,
                      "docker.io/example/api@sha256:" + "b" * 64):
            document = image_manifest()
            document["images"]["api"] = value
            with self.subTest(reference=value), self.assertRaisesRegex(ValueError, "digest"):
                validate_manifest(document)
        document = image_manifest()
        del document["images"]["cep"]
        with self.assertRaises(ValueError):
            validate_manifest(document)

    def test_missing_settings_and_shell_syntax_never_become_ssh_arguments(self):
        with self.assertRaisesRegex(ValueError, "DEPLOY_HOST"):
            ssh_settings({})
        for name, value in (("DEPLOY_HOST", "example.invalid;id"), ("DEPLOY_USER", "deploy$(id)"),
                            ("DEPLOY_DIRECTORY", "/opt/../root"), ("DEPLOY_DIRECTORY", "/opt/name with spaces"),
                            ("DEPLOY_PORT", "0"), ("DEPLOY_PORT", "65536")):
            document = settings()
            document[name] = value
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                ssh_settings(document)

    def test_known_host_key_must_match_the_independently_pinned_fingerprint(self):
        key = self.folder / "synthetic-host-key"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
        public = key.with_suffix(".pub").read_text().split()
        document = settings()
        result = subprocess.run(["ssh-keygen", "-l", "-E", "sha256", "-f", str(key.with_suffix(".pub"))],
                                check=True, capture_output=True, text=True)
        document["DEPLOY_HOST_FINGERPRINT"] = result.stdout.split()[1]
        known_hosts = document["DEPLOY_HOST"] + " " + " ".join(public[:2])
        verify_known_host(ssh_settings(document), known_hosts, self.folder / "known_hosts")
        document["DEPLOY_HOST_FINGERPRINT"] = settings()["DEPLOY_HOST_FINGERPRINT"]
        with self.assertRaisesRegex(ValueError, "FINGERPRINT"):
            verify_known_host(ssh_settings(document), known_hosts, self.folder / "known_hosts")
        with self.assertRaisesRegex(ValueError, "exactly"):
            verify_known_host(ssh_settings(document), known_hosts + "\n" + known_hosts, self.folder / "known_hosts")

    def test_release_bundle_contains_code_and_digest_metadata_without_secrets(self):
        output = self.folder / "release.tar.gz"
        bundle_release(output, image_manifest())
        with tarfile.open(output) as archive:
            names = archive.getnames()
            self.assertIn("compose.yaml", names)
            self.assertIn("tools/deploy_host.py", names)
            self.assertFalse(any(".env" in name or "/secrets/" in name or name.startswith(".cache") for name in names))
            self.assertEqual(json.load(archive.extractfile("images.json")), image_manifest())

    def test_backup_stream_is_gzipped_private_and_existing_output_is_preserved(self):
        destination = self.folder / "synthetic.sql.gz"
        process = Mock(stdout=io.BytesIO(b"-- explicitly synthetic SQL\n"), returncode=0)
        process.communicate.return_value = (None, None)
        with patch("tools.deploy.backup.command", return_value=["docker", "compose"]), \
                patch("tools.deploy.backup.subprocess.Popen", return_value=process):
            backup_database("synthetic-project", destination, {})
        with gzip.open(destination) as handle:
            self.assertEqual(handle.read(), b"-- explicitly synthetic SQL\n")
        if os.name != "nt":
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        before = destination.read_bytes()
        with self.assertRaises(FileExistsError):
            backup_database("synthetic-project", destination, {})
        self.assertEqual(destination.read_bytes(), before)

    def test_backup_failure_cannot_leave_a_completed_dump(self):
        destination = self.folder / "failed.sql.gz"
        process = Mock(stdout=io.BytesIO(b"-- incomplete synthetic SQL\n"), returncode=1)
        process.communicate.return_value = (None, None)
        with patch("tools.deploy.backup.command", return_value=["docker", "compose"]), \
                patch("tools.deploy.backup.subprocess.Popen", return_value=process), self.assertRaises(RuntimeError):
            backup_database("synthetic-project", destination, {})
        self.assertFalse(destination.exists())

    def test_backup_launch_failure_removes_only_its_new_incomplete_output(self):
        destination = self.folder / "launch-failed.sql.gz"
        with patch("tools.deploy.backup.command", return_value=["missing-synthetic-docker"]), \
                patch("tools.deploy.backup.subprocess.Popen", side_effect=FileNotFoundError), \
                self.assertRaises(FileNotFoundError):
            backup_database("synthetic-project", destination, {})
        self.assertFalse(destination.exists())

    def test_actual_compose_configuration_has_only_frontend_loopback_publication(self):
        env = os.environ.copy()
        env["POSEGOOD_SECRETS_DIR"] = str(create_secrets(self.folder / "secrets"))
        env["POSEGOOD_BIND_ADDRESS"] = "127.0.0.1"
        env["POSEGOOD_HTTP_PORT"] = "8080"
        result = subprocess.run(["docker", "compose", "--file", str(ROOT / "compose.yaml"), "config", "--format", "json"],
                                cwd=ROOT, env=env, check=True, capture_output=True, text=True)
        document = json.loads(result.stdout)
        self.assertEqual(set(document["services"]), {"db", "cep", "inference", "api", "frontend"})
        for name in ("db", "cep", "inference", "api"):
            self.assertFalse(document["services"][name].get("ports"))
        ports = document["services"]["frontend"]["ports"]
        self.assertEqual([(item["host_ip"], item["target"]) for item in ports], [("127.0.0.1", 80)])
        self.assertTrue(document["networks"]["private"]["internal"])

    def test_disposable_overlay_attaches_only_mysql_to_its_verification_bridge(self):
        env = os.environ.copy()
        env["POSEGOOD_SECRETS_DIR"] = str(create_secrets(self.folder / "secrets"))
        result = subprocess.run(
            ["docker", "compose", "--file", str(ROOT / "compose.yaml"),
             "--file", str(ROOT / "compose.test.yaml"), "config", "--format", "json"],
            cwd=ROOT, env=env, check=True, capture_output=True, text=True,
        )
        document = json.loads(result.stdout)
        database = document["services"]["db"]
        self.assertEqual(set(database["networks"]), {"private", "verification"})
        self.assertEqual([(port["host_ip"], port["target"]) for port in database["ports"]],
                         [("127.0.0.1", 3306)])
        self.assertFalse(document["networks"]["verification"].get("internal", False))
        for service in ("api", "cep", "inference", "frontend"):
            self.assertNotIn("verification", document["services"][service]["networks"])

    def test_restore_never_connects_when_api_or_frontend_is_running(self):
        for service in ("api", "frontend"):
            containers = Mock(stdout=json.dumps([{"Service": service, "State": "running"}]))
            with self.subTest(service=service), \
                    patch("tools.deploy.restore.run", return_value=containers), \
                    patch("tools.deploy.restore.subprocess.Popen") as launch, self.assertRaisesRegex(ValueError, "stopped"):
                restore_database("synthetic-project", self.folder / "missing.gz", {})
            launch.assert_not_called()

    def test_restore_rejects_existing_tables_before_any_dump_is_sent(self):
        with patch("tools.deploy.restore.run", return_value=Mock(stdout="[]")), \
                patch("tools.deploy.restore.query", return_value="12"), \
                patch("tools.deploy.restore.subprocess.Popen") as launch, self.assertRaisesRegex(ValueError, "empty"):
            restore_database("synthetic-project", self.folder / "missing.gz", {})
        launch.assert_not_called()

    def test_compose_status_supports_array_and_json_lines_without_ignoring_containers(self):
        rows = [{"Service": "db", "State": "running"}, {"Service": "api", "State": "exited"}]
        self.assertEqual(compose_rows(json.dumps(rows)), rows)
        self.assertEqual(compose_rows("\n".join(json.dumps(row) for row in rows)), rows)

    def test_release_metadata_updates_ignore_stale_pending_files_and_clean_failed_temporary_files(self):
        path = self.folder / "current.json"
        stale = self.folder / "current.pending"
        stale.write_text("interrupted prior run")
        atomic_json(path, image_manifest())
        self.assertEqual(json.loads(path.read_text()), image_manifest())
        with patch("tools.deploy.host.os.replace", side_effect=OSError("synthetic interruption")), self.assertRaises(OSError):
            atomic_json(path, image_manifest())
        self.assertEqual(json.loads(path.read_text()), image_manifest())
        self.assertFalse(list(self.folder.glob(".release-manifest-*")))

    def test_deployment_file_lock_rejects_overlap_and_releases_without_removing_the_file(self):
        lock = self.folder / "deployment.lock"
        if os.name == "nt":
            with self.assertRaisesRegex(RuntimeError, "Linux"):
                with deployment_lock(lock):
                    pass
            return
        with deployment_lock(lock):
            with self.assertRaisesRegex(RuntimeError, "currently running"):
                with deployment_lock(lock):
                    pass
        self.assertTrue(lock.exists())
        with deployment_lock(lock):
            pass

    def test_reapplying_the_current_release_keeps_the_previous_digest_manifest(self):
        deployment = self.folder / "deployment"
        deployment.mkdir(mode=0o700)
        first = image_manifest()
        second = image_manifest()
        second["git_sha"] = "c" * 40
        second["images"]["api"] = "ghcr.io/example/synthetic-api@sha256:" + "d" * 64
        for document in (first, second):
            release = deployment / "releases" / document["git_sha"]
            release.mkdir(parents=True)
            # Bundled release metadata and host state intentionally use different formatting.
            (release / "images.json").write_text(json.dumps(document))
        payload = {"secrets": {}, "registry_user": "synthetic-user", "registry_token": "synthetic-token"}
        with patch("tools.deploy.host.require_daemon"), \
                patch("tools.deploy.host.create_secrets", return_value=self.folder / "secrets"), \
                patch("tools.deploy.host.backup_database"), \
                patch("tools.deploy.host.run"), \
                patch("subprocess.run"):
            apply_release(deployment, first["git_sha"], payload)
            apply_release(deployment, second["git_sha"], payload)
            apply_release(deployment, second["git_sha"], payload)
        shared = deployment / "shared"
        self.assertEqual(json.loads((shared / "current.json").read_text()), second)
        self.assertEqual(json.loads((shared / "previous.json").read_text()), first)

    def test_cleanup_checks_exact_project_labels_and_rejects_remaining_resources(self):
        with patch("tools.deploy.compose.command", return_value=["docker"]), \
                patch("tools.deploy.compose.subprocess.run", return_value=Mock(stdout="")) as run:
            assert_project_removed("synthetic-project", {})
        self.assertEqual(run.call_count, 3)
        self.assertTrue(all("label=com.docker.compose.project=synthetic-project" in call.args[0]
                            for call in run.call_args_list))
        with patch("tools.deploy.compose.command", return_value=["docker"]), \
                patch("tools.deploy.compose.subprocess.run", return_value=Mock(stdout="synthetic-resource-id\n")), \
                self.assertRaisesRegex(AssertionError, "containers"):
            assert_project_removed("synthetic-project", {})

    def test_actual_engine_port_lookup_requires_one_private_valid_binding(self):
        binding = {"HostIp": "127.0.0.1", "HostPort": "49152"}
        with patch("tools.deploy.compose.run", return_value=Mock(stdout="a" * 64)), \
                patch("tools.deploy.compose.docker_executable", return_value="docker"), \
                patch("tools.deploy.compose.subprocess.run", return_value=Mock(stdout=json.dumps({"3306/tcp": [binding]}))):
            self.assertEqual(loopback_publication("synthetic-project", "db", 3306, {}), "127.0.0.1:49152")
        for bindings in ([], [binding, binding], [{**binding, "HostIp": "0.0.0.0"}],
                         [{**binding, "HostPort": "0"}], [{**binding, "HostPort": "65536"}]):
            with self.subTest(bindings=bindings), \
                    patch("tools.deploy.compose.run", return_value=Mock(stdout="a" * 64)), \
                    patch("tools.deploy.compose.docker_executable", return_value="docker"), \
                    patch("tools.deploy.compose.subprocess.run", return_value=Mock(stdout=json.dumps({"3306/tcp": bindings}))), \
                    self.assertRaises(ValueError):
                loopback_publication("synthetic-project", "db", 3306, {})

    def test_mysql_integration_uses_repository_settings_and_selected_cache_without_secret_arguments(self):
        # Import the CLI with the same module search path as `python tools/compose_smoke.py`.
        with patch.object(sys, "path", [str(ROOT / "tools")] + sys.path):
            smoke = importlib.import_module("compose_smoke")
        secret_directory = self.folder / "synthetic-mysql-secrets"
        secret_directory.mkdir(mode=0o700)
        password = "explicitly-synthetic-password-" + "a" * 32
        (secret_directory / "spring.datasource.password").write_text(password)
        for override in (None, str(self.folder / "custom-maven-cache")):
            env = {} if override is None else {"POSEGOOD_MAVEN_CACHE": override}
            expected_cache = override or str(ROOT / ".cache" / "maven")
            with self.subTest(cache=override), \
                    patch.object(smoke, "mysql_address", return_value="127.0.0.1:49152"), \
                    patch.object(smoke, "maven_executable", return_value="synthetic-mvn"), \
                    patch.object(smoke.subprocess, "run") as launch:
                smoke.mysql_integration("synthetic-project", env, secret_directory)
            arguments = launch.call_args.args[0]
            self.assertEqual(arguments, [
                "synthetic-mvn", "-B", "-ntp", "-s", "tools/maven-settings.xml",
                "-gs", "tools/maven-settings.xml", "-Dmaven.repo.local=" + expected_cache,
                "-f", "backend/pom.xml", "-pl", "api", "-am", "-Pmysql-integration", "verify",
            ])
            self.assertFalse(any(password in argument for argument in arguments))
            options = launch.call_args.kwargs
            self.assertEqual(options["cwd"], ROOT)
            self.assertEqual(options["env"]["POSEGOOD_TEST_MYSQL_PASSWORD"], password)
            self.assertEqual(options["env"]["POSEGOOD_TEST_MYSQL_DISPOSABLE"], "true")
            self.assertEqual(options["env"]["POSEGOOD_TEST_MYSQL_SYNTHETIC"], "true")
            self.assertEqual(env, {} if override is None else {"POSEGOOD_MAVEN_CACHE": override})


if __name__ == "__main__":
    unittest.main()
