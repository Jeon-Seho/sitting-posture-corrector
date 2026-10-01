"""Setup, verification and local server workflows used by the dev CLI."""

import os
import sys

if __package__:
    from .runtime import (
        ROOT, VENV, java_executable, maven_executable, npm, require_venv,
        run, service_jar, venv_python,
    )
else:
    from runtime import (
        ROOT, VENV, java_executable, maven_executable, npm, require_venv,
        run, service_jar, venv_python,
    )


def setup_python():
    run(sys.executable, "-m", "venv", VENV)
    run(venv_python(), "-m", "pip", "install", "-r", "requirements-dev.txt")


def setup_frontend():
    npm("ci")
    npm("run", "assets")


def setup():
    setup_python()
    setup_frontend()


def check_repo():
    run(sys.executable, "tools/check_repository.py")


def test():
    run(require_venv(), "-m", "unittest", "discover", "-s", "tests", "-v")


def check_frontend():
    npm("run", "check")


def check_backend():
    settings = "tools/maven-settings.xml"
    cache = os.environ.get("POSEGOOD_MAVEN_CACHE", str(ROOT / ".cache" / "maven"))
    run(
        maven_executable(), "-B", "-ntp", "-s", settings, "-gs", settings,
        "-Dmaven.repo.local=" + cache, "-f", "backend/pom.xml", "verify",
    )
    run(venv_python(), "tools/service_smoke.py")
    run(
        venv_python(), "tools/server_benchmark.py",
        "--target", "both", "--warmup", "1", "--repetitions", "4",
        "--concurrency", "2", "--timeout", "5",
        "--output", ".cache/benchmarks/smoke.json",
    )


def check_browser():
    run(require_venv(), "tools/browser_smoke.py")


def benchmark_server():
    run(
        require_venv(), "tools/server_benchmark.py",
        "--output", ".cache/benchmarks/server.json",
    )


def init_compose():
    run(sys.executable, "tools/compose_init.py")


def check_compose():
    run(require_venv(), "tools/compose_smoke.py")


def check_local():
    check_repo()
    test()
    check_frontend()
    check_backend()
    check_browser()


def check():
    check_local()
    check_compose()


def dev_service(component, artifact):
    jar = service_jar(component, artifact)
    if not jar.is_file():
        sys.exit("먼저 check-backend를 실행하세요.")
    run(java_executable(), "-jar", jar)


def dev_api():
    dev_service("api", "session-api")


def dev_cep():
    dev_service("cep", "cep-service")


def dev_inference():
    run(
        venv_python(), "-m", "uvicorn", "model.inference.app:app",
        "--host", "127.0.0.1", "--port", "8092", "--no-access-log",
    )


def dev():
    npm("run", "dev")
