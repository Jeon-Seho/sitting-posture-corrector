"""Setup, verification and local server workflows used by the dev CLI."""

import sys

if __package__:
    from .runtime import (
        VENV, gradle_command, java_executable, npm, require_venv,
        run, service_jar, venv_python,
    )
else:
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


def test():
    run(require_venv(), "-m", "unittest", "discover", "-s", "tests", "-v")


def check_frontend():
    npm("run", "check")


def gradle(*arguments, env=None):
    run(*gradle_command(*arguments), env=env)


def check_backend():
    """Default unit tests, Checkstyle and build; MySQL integration is explicit."""
    gradle("build")


def init_compose():
    run(sys.executable, "tools/compose_init.py")


def check_local():
    test()
    check_frontend()
    check_backend()


def check():
    check_local()


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
