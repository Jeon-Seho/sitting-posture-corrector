"""Fetch remote branch metadata and report advisory overlap; never merge or reset."""
from pathlib import Path
import subprocess
import threading
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
_lock = threading.Lock()
_cache = None
_last_attempt = 0


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True,
                          encoding="utf-8", errors="replace", timeout=25).stdout.strip()


def inspect():
    global _cache, _last_attempt
    with _lock:
        if _cache and time.monotonic() - _last_attempt < 300: return _cache
        _last_attempt = time.monotonic()
        try:
            git("-c", "credential.interactive=false", "fetch", "origin")
            branch = git("branch", "--show-current")
            dirty = set(filter(None, git("diff", "--name-only", "HEAD").splitlines()))
            dirty.update(filter(None, git("ls-files", "--others", "--exclude-standard").splitlines()))
            rows = git("for-each-ref", "--sort=-committerdate", "--count=30", "--format=%(refname:short)|%(objectname)|%(committerdate:iso-strict)", "refs/remotes/origin").splitlines()
            branches = []
            for row in rows:
                name, sha, date = row.split("|", 2)
                if name in ("origin/HEAD", "origin"): continue
                ahead = int(git("rev-list", "--count", "HEAD.." + name))
                files = []
                if ahead:
                    base = git("merge-base", "HEAD", name)
                    files = git("diff", "--name-only", base, name).splitlines()
                branches.append(dict(name=name, sha=sha, date=date, ahead=ahead,
                                     overlap=sorted(dirty.intersection(files)), files=files[:60], totalFiles=len(files)))
            _cache = dict(branch=branch, branches=branches, checkedAt=datetime.now(timezone.utc).isoformat(), error="", fresh=True)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            _cache = dict(_cache or {"branches": [], "checkedAt": None})
            _cache.update(error="원격 갱신 실패. 네트워크·Git 접근 권한을 확인하세요.", fresh=False)
        return _cache


if __name__ == "__main__":
    import json
    import sys
    if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
    result = inspect()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["fresh"] else 1)
