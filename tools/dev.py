"""Cross-platform setup and check entry point (Windows, macOS, Linux).

`make <target>` delegates here. Without make, run `python tools/dev.py <target>`.
"""

import subprocess
import sys

if __package__:
    from .server_dev import dev_server
else:
    from server_dev import dev_server

if __package__:
    from .dev_tasks import (
        benchmark_server, board, check, check_backend, check_board, check_browser, check_compose,
        check_frontend, check_local, check_repo, dev, dev_api, dev_cep,
        dev_inference, init_compose, setup, setup_frontend, setup_python, test,
    )
else:
    from dev_tasks import (
        benchmark_server, board, check, check_backend, check_board, check_browser, check_compose,
        check_frontend, check_local, check_repo, dev, dev_api, dev_cep,
        dev_inference, init_compose, setup, setup_frontend, setup_python, test,
    )


COMMANDS = {
    "setup": setup,
    "setup-python": setup_python,
    "setup-frontend": setup_frontend,
    "check": check,
    "check-local": check_local,
    "check-compose": check_compose,
    "init-compose": init_compose,
    "check-repo": check_repo,
    "test": test,
    "check-frontend": check_frontend,
    "check-board": check_board,
    "board": board,
    "check-backend": check_backend,
    "check-browser": check_browser,
    "benchmark-server": benchmark_server,
    "dev": dev,
    "dev-api": dev_api,
    "dev-cep": dev_cep,
    "dev-inference": dev_inference,
    "dev-server": dev_server,
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
