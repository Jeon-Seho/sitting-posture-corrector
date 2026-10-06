"""Numbered work lifecycle for humans and AI. All writes use the board conflict API."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import urllib.request
import urllib.error
import uuid

from server import ROOT, HERE, CATEGORIES, STATUSES, STAGES, MY_WORK_ORDER, default_assignees, documents, git_activity, my_work, read_store, validate_ai

URL = "http://127.0.0.1:8774"
FOLDERS = dict(zip(CATEGORIES, ("frontend", "backend", "devops", "server", "machine-learning", "paper", "database")))


def now(): return datetime.now(timezone.utc).isoformat()


def save(data, version, by, message):
    validate_ai(by)
    request = urllib.request.Request(URL + "/api/workspace", method="POST",
        data=json.dumps(dict(data=data, version=version, actor="ai", by=by, message=message), ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": URL})
    try:
        with urllib.request.urlopen(request, timeout=10) as response: return json.load(response)
    except urllib.error.HTTPError as error: raise ValueError(error.read().decode("utf-8")) from error


def new_card(title, category, source, body, by, status="planned"):
    return dict(id=str(uuid.uuid4()), title=title, category=category, source=source, body=body,
                status=status, author="", assignees=[], agent=by, result="", updated=now(), log=[])


def find(data, number):
    matches = [c for c in data["cards"] if c.get("number", "").upper() == number.upper() or c["id"] == number]
    if len(matches) != 1: raise ValueError("작업 번호가 없거나 중복입니다. work.py list로 확인하세요.")
    return matches[0]


def unseen(card):
    log = card.get("log", [])
    last_ai = max((i for i, entry in enumerate(log) if entry["kind"] == "ai"), default=-1)
    return any(entry["kind"] == "user" for entry in log[last_ai + 1:])


def safe_path(path):
    target = (ROOT / path).resolve()
    target.relative_to(ROOT.resolve())
    if not path.startswith("docs/") or target.suffix != ".md" or any(p.startswith(".") for p in Path(path).parts):
        raise ValueError("새 문서는 docs/ 아래 .md 경로를 사용하세요.")
    return target


def audit(data, docs, legacy):
    problems = []
    by_number = {c.get("number"): c for c in data["cards"]}
    paths = {d["path"] for d in docs}
    for card in data["cards"]:
        if card.get("stage") not in {s["id"] for s in STAGES}:
            problems.append(card.get("number", "?") + ": 프로젝트 단계 지정 필요")
        if not card.get("number") or card.get("category") not in CATEGORIES:
            problems.append(card["id"] + ": 작업 번호/분야 누락")
        if card["source"] and card["source"] not in paths:
            problems.append(card.get("number", "?") + ": 근거 MD 누락 " + card["source"])
        if card["status"] in ("in_progress", "review", "completed") and not card["source"]:
            problems.append(card.get("number", "?") + ": 진행 작업에는 근거 MD가 필요합니다")
    for doc in docs:
        if doc["path"] in legacy and not doc.get("task"): continue
        declared = re.search(r"^- 분야:\s*(.+)$", doc["body"], re.M)
        if not declared or any(c.strip() not in CATEGORIES for c in declared.group(1).split(",")):
            problems.append(doc["path"] + ": 명시적인 분야 메타데이터 필요")
        card = by_number.get(doc.get("task"))
        if not card:
            problems.append(doc["path"] + ": 등록된 작업 번호 필요 (- 작업: GP-0001)")
        elif declared and card["category"] not in [c.strip() for c in declared.group(1).split(",")]:
            problems.append(doc["path"] + ": 작업 카드와 MD 분야 불일치")
        elif card["source"] not in paths:
            problems.append(doc["path"] + ": 연결 카드의 근거 문서 누락")
    for doc in docs:
        if doc["status"] and not any(c["source"] == doc["path"] or c.get("number") == doc.get("task") for c in data["cards"]):
            problems.append(doc["path"] + ": 계획 카드 등록 누락 (sync-plans 또는 create-doc 사용)")
    return problems


def main():
    if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    listing = sub.add_parser("list")
    listing.add_argument("--category", choices=CATEGORIES)
    listing.add_argument("--status", choices=STATUSES)
    sub.add_parser("inbox")
    mine = sub.add_parser("mine", help="Open cards assigned to you (git user.name/email → team.json)")
    mine.add_argument("--member", help="팀원 이름. 생략하면 git 사용자로 찾는다")
    mine.add_argument("--json", action="store_true")
    sub.add_parser("check")
    sub.add_parser("show").add_argument("number")
    sync = sub.add_parser("sync-plans", help="Register existing MD plans once without duplicates")
    sync.add_argument("--by", required=True)
    sync.add_argument("--stage", required=True, choices=[s["id"] for s in STAGES])
    add = sub.add_parser("add")
    add.add_argument("--title", required=True)
    add.add_argument("--category", choices=CATEGORIES, required=True)
    add.add_argument("--source", default="")
    add.add_argument("--body", default="")
    add.add_argument("--by", required=True)
    create = sub.add_parser("create-doc", help="Create a categorized MD and its numbered card together")
    create.add_argument("--title", required=True)
    create.add_argument("--category", choices=CATEGORIES, required=True)
    create.add_argument("--slug", required=True)
    create.add_argument("--by", required=True)
    create.add_argument("--body", default="요구사항과 완료 기준을 구체화한다.")
    for command in (add, create):
        command.add_argument("--stage", required=True, choices=[s["id"] for s in STAGES])
    for name in ("move", "log", "link"):
        cmd = sub.add_parser(name)
        cmd.add_argument("number")
        cmd.add_argument("--by", required=True)
        cmd.add_argument("--note", required=True)
        cmd.add_argument("--version", required=True)
        if name == "move":
            cmd.add_argument("status", choices=STATUSES)
            cmd.add_argument("--evidence", default="")
            cmd.add_argument("--performed-by", default="")
            cmd.add_argument("--commit", default="")
        if name == "link": cmd.add_argument("--source", required=True)
    args = parser.parse_args()
    data, version = read_store()
    if args.command == "check":
        legacy = json.loads((HERE / "legacy-docs.json").read_text(encoding="utf-8"))
        problems = audit(data, documents(), set(legacy))
        print("\n".join(problems) if problems else "PASS: MD categories, numbered work cards and source links")
        return int(bool(problems))
    if args.command in ("list", "inbox"):
        rows = data["cards"]
        if args.command == "inbox": rows = [c for c in rows if unseen(c)]
        else: rows = [c for c in rows if (not args.category or c.get("category") == args.category) and (not args.status or c["status"] == args.status)]
        print(json.dumps(dict(version=version, cards=rows), ensure_ascii=False, indent=2))
        return 0
    if args.command == "mine":
        members = [p["name"] for p in json.loads((HERE / "team.json").read_text(encoding="utf-8"))]
        member = args.member or git_activity()["me"]
        if member not in members:
            raise ValueError("git 사용자(user.name/user.email)로 팀원을 찾지 못했습니다. --member 이름(" + "·".join(members)
                             + ")으로 실행하고, 계정 별칭은 docs/team.md에 확인 후 team.json에 등록하세요.")
        groups = my_work(data, member)
        if args.json:
            print(json.dumps(dict(version=version, member=member, groups=groups), ensure_ascii=False, indent=2))
            return 0
        labels = dict(in_progress="진행 중", review="검수 대기", blocked="결정·확인 필요", ready="바로 시작 가능", waiting="선행 작업 대기")
        total = sum(len(v) for v in groups.values())
        print(f"{member}님에게 배정된 미완료 작업 {total}개")
        for key in MY_WORK_ORDER:
            if not groups[key]: continue
            print()
            print(f"[{labels[key]}] {len(groups[key])}개")
            for card in groups[key]:
                extra = f" · 선행 {', '.join(card['waitingFor'])}" if card["waitingFor"] else ""
                stars = "★" * (card.get("priority") or 0)
                print(f"  {card['number']} {stars}{' ' if stars else ''}{card['title']} · {card['category']}{extra}")
                if card.get("source"): print(f"      근거: {card['source']}")
        first = next((groups[k][0] for k in MY_WORK_ORDER if k != "waiting" and groups[k]), None)
        if first:
            print()
            print(f"다음: python tools/project-board/work.py show {first['number']}")
        return 0
    if args.command == "show":
        card = find(data, args.number)
        related = [d["path"] for d in documents() if d.get("task") == card.get("number")]
        print(json.dumps(dict(version=version, card=card, documents=related), ensure_ascii=False, indent=2))
        return 0
    target = None
    if args.command == "sync-plans":
        sources = {c["source"] for c in data["cards"]}
        initial_count = len(data["cards"])
        for doc in sorted(documents(), key=lambda d: Path(d["path"]).name):
            if not doc["status"] or doc["path"] in sources: continue
            card = new_card(doc["title"], doc["group"], doc["path"], "기존 계획서에서 등록. 구현·검증 이력은 근거 문서 참조.", args.by, doc["status"])
            card["assignees"] = data["assignments"].get(doc["path"], [])
            if card["status"] == "completed": card["evidence"] = "기존 완료 계획: " + doc["path"]
            card["plan"] = True
            card["stage"] = args.stage
            data["cards"].append(card)
        if len(data["cards"]) == initial_count:
            print("계획 등록 상태 확인 완료")
            return 0
    elif args.command in ("add", "create-doc"):
        source = args.source if args.command == "add" else ""
        if source and source not in {d["path"] for d in documents()}: raise ValueError("존재하는 근거 MD를 지정하세요.")
        if args.command == "create-doc":
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.slug): raise ValueError("slug는 영문 소문자·숫자·하이픈을 사용하세요.")
            source = f"docs/areas/{FOLDERS[args.category]}/{args.slug}.md"
            target = safe_path(source)
            if target.exists(): raise ValueError("이미 존재하는 문서입니다. 기존 작업을 조회해서 이어가세요.")
        card = new_card(args.title, args.category, source, args.body, args.by)
        card["assignees"] = default_assignees(args.category)
        card["stage"] = args.stage
        data["cards"].append(card)
    else:
        if args.version != version: raise ValueError("다른 변경이 있습니다. show로 원문과 최신 버전을 다시 확인하세요.")
        card = find(data, args.number)
        if args.command == "move":
            if args.status == "completed" and not args.evidence.strip(): raise ValueError("배정 여부와 무관하게 완료할 수 있습니다. --evidence에 실제 완료·검증 근거를 남기세요.")
            if args.evidence: card["evidence"] = args.evidence
            if args.performed_by: card["performedBy"] = args.performed_by
            if args.commit:
                matches = [c for c in git_activity()["commits"] if c["hash"].startswith(args.commit)]
                if len(args.commit) < 7 or len(matches) != 1: raise ValueError("최근 커밋에서 고유한 해시를 찾지 못했습니다.")
                commit = matches[0]
                if not args.performed_by: card["performedBy"] = commit["member"] or ("미연결: " + commit["author"])
                card["evidence"] = (card.get("evidence", "") + "\n커밋: " + commit["hash"]).strip()
            if args.status in ("in_progress", "review", "completed") and card["source"] not in {d["path"] for d in documents()}:
                raise ValueError("먼저 link 명령으로 근거 MD를 연결하세요.")
            card["status"] = args.status
        if args.command == "link":
            if args.source not in {d["path"] for d in documents()}: raise ValueError("근거 MD가 존재하지 않습니다.")
            card["source"] = args.source
        card["agent"] = args.by
        card["updated"] = now()
        card["result"] = args.note
    saved = save(data, version, args.by, getattr(args, "note", "계획 등록" if args.command == "sync-plans" else "작업 등록"))
    if args.command == "sync-plans":
        print(json.dumps(dict(version=saved["version"], registered=len(saved["data"]["cards"])), ensure_ascii=False))
        return 0
    card = next(c for c in saved["data"]["cards"] if c["id"] == card["id"])
    if target:
        target.parent.mkdir(parents=True, exist_ok=True)
        text = f"# {args.title}\n\n- 분야: {args.category}\n- 작업: {card['number']}\n\n## 요청과 완료 기준\n\n{args.body}\n\n## 진행 기록\n\n- 작업 카드의 이력과 함께 최신 결정·수정·검증 결과를 기록한다.\n\n## 검증과 남은 사항\n\n- 아직 검증하지 않았다.\n"
        try:
            with target.open("x", encoding="utf-8") as stream: stream.write(text)
        except OSError as error:
            raise ValueError(f"{card['number']} 등록됨. MD 생성 실패: {error}. 이 번호로 문서를 복구하고 check를 실행하세요.") from error
    print(json.dumps(dict(version=saved["version"], card=card), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
