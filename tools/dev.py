"""Cross-platform setup and check entry point (Windows, macOS, Linux).

`make <target>` delegates here. Without make, run `python tools/dev.py <target>`.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv"


def venv_python():
    # Windows venvs put the interpreter in Scripts/, POSIX venvs in bin/.
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(*command):
    print("$ " + " ".join(str(part) for part in command), flush=True)
    subprocess.run([str(part) for part in command], cwd=ROOT, check=True)


def npm(*args):
    executable = shutil.which("npm")
    if executable is None:
        sys.exit("npm을 찾을 수 없습니다. Node.js 24 이상을 설치하세요.")
    run(executable, "--prefix", "frontend", *args)


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
    if not venv_python().exists():
        sys.exit("가상환경이 없습니다. 먼저 setup을 실행하세요: python tools/dev.py setup")
    run(venv_python(), "-m", "unittest", "discover", "-s", "tests", "-v")


def check_frontend():
    npm("run", "check")


def check():
    check_repo()
    test()
    check_frontend()
    check_backend()


def check_backend():
    executable = os.environ.get("MAVEN_EXECUTABLE") or shutil.which("mvn")
    if not executable:
        sys.exit("Maven과 Java 21이 필요합니다. backend/README.md의 준비 절차를 확인하세요.")
    arguments = [executable, "-B", "-ntp", "-s", "tools/maven-settings.xml", "-gs", "tools/maven-settings.xml"]
    cache = os.environ.get("POSEGOOD_MAVEN_CACHE", str(ROOT / ".cache" / "maven"))
    run(*arguments, "-Dmaven.repo.local=" + cache, "-f", "backend/pom.xml", "verify")
    run(venv_python(), "tools/service_smoke.py")


def dev_service(component, artifact):
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from tools.service_smoke import java_executable
    jar = ROOT / "backend" / component / "target" / (artifact + "-0.1.0-SNAPSHOT.jar")
    if not jar.is_file():
        sys.exit("먼저 check-backend를 실행하세요.")
    run(java_executable(), "-jar", jar)


def dev_api():
    dev_service("api", "session-api")


def dev_cep():
    dev_service("cep", "cep-service")


def dev_inference():
    run(venv_python(), "-m", "uvicorn", "model.inference.app:app", "--host", "127.0.0.1", "--port", "8092", "--no-access-log")


def dev():
    npm("run", "dev")


COMMANDS = {
    "setup": setup,
    "setup-python": setup_python,
    "setup-frontend": setup_frontend,
    "check": check,
    "check-repo": check_repo,
    "test": test,
    "check-frontend": check_frontend,
    "check-backend": check_backend,
    "dev": dev,
    "dev-api": dev_api,
    "dev-cep": dev_cep,
    "dev-inference": dev_inference,
}


def main(argv):
    if len(argv) != 1 or argv[0] not in COMMANDS:
        print("usage: python tools/dev.py {" + ",".join(COMMANDS) + "}", file=sys.stderr)
        return 2
    try:
        COMMANDS[argv[0]]()
    except subprocess.CalledProcessError as error:
        return error.returncode or 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
