"""Shared paths, executable discovery and subprocess invocation for dev tools."""

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv"


def venv_python() -> Path:
    # Windows venvs put the interpreter in Scripts/, POSIX venvs in bin/.
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def require_venv() -> Path:
    python = venv_python()
    if not python.exists():
        sys.exit("가상환경이 없습니다. 먼저 setup을 실행하세요: python tools/dev.py setup")
    return python


def run(*command, env=None) -> None:
    arguments = [str(part) for part in command]
    print("$ " + " ".join(arguments), flush=True)
    subprocess.run(arguments, cwd=ROOT, check=True, env=env)


def npm(*args) -> None:
    executable = shutil.which("npm")
    if executable is None:
        sys.exit("npm을 찾을 수 없습니다. Node.js 24 이상을 설치하세요.")
    run(executable, "--prefix", "frontend", *args)


def java_executable() -> str:
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        path = Path(java_home) / "bin" / ("java.exe" if os.name == "nt" else "java")
        if path.is_file():
            return str(path)
    path = shutil.which("java")
    if path is None:
        raise RuntimeError("Java 17 is required")
    return path


def gradle_executable() -> str:
    """The backend's Gradle Wrapper (backend/README.md); it downloads Gradle itself and needs only Java 17+."""
    wrapper = ROOT / "backend" / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not wrapper.is_file():
        sys.exit("backend/gradlew가 없습니다. Java 17 이상과 backend/README.md의 준비 절차를 확인하세요.")
    return str(wrapper)


def gradle_command(*arguments, environment=None) -> list:
    """A backend Gradle invocation. The repository-local Gradle home keeps personal init scripts
    and gradle.properties out of verification (POSEGOOD_GRADLE_HOME overrides it)."""
    environment = os.environ if environment is None else environment
    home = environment.get("POSEGOOD_GRADLE_HOME", str(ROOT / ".cache" / "gradle"))
    return [
        gradle_executable(), "--no-daemon", "--console=plain", "--gradle-user-home", home,
        "-p", "backend", *arguments,
    ]


def service_jar(component: str, artifact: str) -> Path:
    return ROOT / "backend" / component / "build" / "libs" / f"{artifact}-0.1.0-SNAPSHOT.jar"
