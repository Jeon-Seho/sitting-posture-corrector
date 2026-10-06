"""AI-facing inbox reader and conflict-checked note result writer."""
import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

from server import read_store, STATUSES, validate_ai

URL = "http://127.0.0.1:8774"


def main():
    if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"): sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inbox = sub.add_parser("inbox")
    inbox.add_argument("--all", action="store_true")
    show = sub.add_parser("show")
    show.add_argument("id")
    result = sub.add_parser("result")
    result.add_argument("id")
    result.add_argument("--status", choices=STATUSES, required=True)
    result.add_argument("--agent", required=True)
    result.add_argument("--result-file", type=Path, required=True)
    result.add_argument("--version", required=True, help="Version printed by show/inbox; rejects intervening edits")
    args = parser.parse_args()
    data, version = read_store()
    if args.command == "inbox":
        print(json.dumps({"version": version, "notes": [n for n in data["notes"] if args.all or n["status"] != "completed"]}, ensure_ascii=False, indent=2))
        return 0
    note = next((n for n in data["notes"] if n["id"] == args.id), None)
    if not note: raise ValueError("메모 ID를 찾을 수 없습니다.")
    if args.command == "show":
        print(json.dumps({"version": version, "note": note}, ensure_ascii=False, indent=2))
        return 0
    if version != args.version: raise ValueError("파일이 변경됐습니다. show로 최신 요청을 다시 확인하세요.")
    validate_ai(args.agent)
    entry = args.result_file.read_text(encoding="utf-8-sig").strip()
    if not entry: raise ValueError("빈 처리 결과는 저장할 수 없습니다.")
    timestamp = datetime.now(timezone.utc).isoformat()
    note["result"] = (note["result"] + "\n\n" if note["result"] else "") + f"[{timestamp}] {args.agent}\n{entry}"
    note["status"] = args.status
    note["agent"] = args.agent
    note["updated"] = timestamp
    request = urllib.request.Request(URL + "/api/workspace", method="POST",
        data=json.dumps({"data": data, "version": version, "actor": "ai", "by": args.agent}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": URL})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            saved = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(error.read().decode("utf-8")) from error
    print(json.dumps({"saved": args.id, "version": saved["version"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
