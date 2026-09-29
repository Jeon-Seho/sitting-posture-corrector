"""Start the local board without opening a persistent console window."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import webbrowser

HERE = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8774"


def health():
    try:
        with urllib.request.urlopen(URL + "/api/health", timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError): return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    state = health()
    if not state:
        log_path = Path(tempfile.gettempdir()) / "goodpose-project-board.log"
        with log_path.open("a", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, str(HERE / "server.py")], cwd=HERE,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        for _ in range(40):
            state = health()
            if state: break
            if process.poll() is not None: break
            time.sleep(.15)
    if not state or state.get("app") != "goodpose-project-board-v1" or Path(state.get("root", "")).resolve() != HERE.parents[1]:
        print("Port 8774 is unavailable or belongs to another checkout. Check %TEMP%/goodpose-project-board.log")
        return 1
    print("GoodPose board ready: " + URL)
    if not args.no_browser: webbrowser.open(URL)
    return 0


if __name__ == "__main__": raise SystemExit(main())
