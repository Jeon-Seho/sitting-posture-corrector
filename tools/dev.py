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


def check_board():
    run("node", "--check", "tools/project-board/app.js")
    run(sys.executable, "tools/project-board/work.py", "check")


def check():
    check_repo()
    test()
    check_frontend()
    check_board()


def board():
    run(sys.executable, "tools/project-board/launch.py")


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
    "dev": dev,
    "check-board": check_board,
    "board": board,
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
