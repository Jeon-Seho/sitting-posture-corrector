"""Setup, verification and local server workflows used by the dev CLI."""

import sys

if __package__:
    from .test_mysql import mysql_server
    from .runtime import (
        VENV, gradle_command, java_executable, npm, require_venv,
        run, service_jar, venv_python,
    )
else:
    from test_mysql import mysql_server
    from runtime import (
        VENV, gradle_command, java_executable, npm, require_venv,
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


def gradle(*arguments, env=None):
    run(*gradle_command(*arguments), env=env)


def check_backend():
    """Unit tests, then real-MySQL integration tests and the HTTP smoke with real inference.

    MySQL comes from tools/test_mysql.py (configured loopback server or a temporary Docker
    container); a missing MySQL fails the check instead of skipping it.
    """
    gradle("build")
    with mysql_server() as server:
        gradle("build", "-Pmysql-integration", env=server.environment())
        run(venv_python(), "tools/service_smoke.py", env=server.environment())


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


def dev_inference():
    run(
        venv_python(), "-m", "uvicorn", "model.inference.app:app",
        "--host", "127.0.0.1", "--port", "8092", "--no-access-log",
    )


def dev():
    npm("run", "dev")
