"""GoodPose's local document library and persistent project board (stdlib only)."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8774
IDENTITY = "goodpose-project-board-v1"
STORE = HERE / "workspace.json"
LOCK = Lock()
STATUSES = ("planned", "in_progress", "review", "blocked", "completed")
MEMBERS = ("우진", "동욱", "세호", "유진", "지성", "홍규")
CATEGORIES = ("프론트", "백엔드", "데브옵스", "서버", "머신러닝", "논문", "DB")
SKIP = {".git", ".venv", "node_modules", "dist", "build", "__pycache__", "outputs", "data", "artifacts", "runs", "checkpoints"}


def groups(path, title):
    """Topic shelves can overlap; folder location is retained independently."""
    categories = []
    rules = (
        ("프론트", path.startswith("frontend/") or path in {"DESIGN.md", "PRODUCT.md", "docs/team-requirements.md", "docs/persona-flow-review.md", "docs/product-spec.md"} or bool(re.search(r"프론트|화면|시각|서비스 흐름|점수|frontend", title, re.I))),
        ("백엔드", path.startswith(("backend/", "contracts/")) or path in {"docs/team-requirements.md", "docs/architecture.md"} or bool(re.search(r"API|인증|백엔드", title))),
        ("데브옵스", path.startswith("tools/") or path in {"AGENTS.md", "README.md", "docs/index.md", "docs/development.md", "docs/quality.md", "docs/project-board.md", "docs/team.md", "docs/plans/template.md"} or bool(re.search(r"하네스|관리판|배포|CI", title))),
        ("서버", path.startswith("backend/") or path == "docs/architecture.md" or bool(re.search(r"서버|런타임|인프라", title))),
        ("머신러닝", path.startswith(("model/", "contracts/", "docs/research/")) or bool(re.search(r"추적|웹캠|평활화|수집|CSV|시계열|AI 자세", title))),
        ("논문", path.startswith(("docs/research/", "docs/references/")) or bool(re.search(r"논문|연구|계획서 참고", title))),
        ("DB", path.startswith("database/") or path in {"docs/architecture.md", "docs/team-requirements.md"} or bool(re.search(r"데이터베이스|스키마|마이그레이션", title))),
    )
    for category, matched in rules:
        if matched: categories.append(category)
    return categories or ["데브옵스"]


def documents(root=ROOT):
    result = []
    for base, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith(".") and not (Path(base) / d).is_symlink())
        for name in sorted(files):
            file = Path(base) / name
            if file.suffix.lower() != ".md" or file.is_symlink(): continue
            path = file.relative_to(root).as_posix()
            body = file.read_text(encoding="utf-8-sig")
            title = re.search(r"^#\s+(.+)$", body, re.M)
            tasks = re.findall(r"^\s*[-*]\s+\[([ xX])\]", body, re.M)
            state = re.search(r"^\s*-\s*상태:\s*(\w+)", body, re.M)
            owner = re.search(r"^\s*-\s*담당:\s*(.*)$", body, re.M)
            is_plan = path.startswith(("docs/plans/active/", "docs/plans/completed/"))
            status = None
            if is_plan:
                status = "completed" if "/completed/" in path else (state.group(1) if state else "in_progress")
                if status not in STATUSES: status = "in_progress"
            categories = groups(path, title.group(1) if title else name)
            declared = re.search(r"^- 분야:\s*(.+)$", body, re.M)
            task = re.search(r"^- 작업:\s*(GP-\d+)$", body, re.M)
            if declared: categories = [x.strip() for x in declared.group(1).split(",")]
            result.append(dict(path=path, title=title.group(1) if title else name, body=body,
                               group=categories[0], groups=categories, task=task.group(1) if task else "", modified=file.stat().st_mtime,
                               status=status, owner=owner.group(1).strip() if owner else "",
                               total=len(tasks), checked=sum(t.lower() == "x" for t in tasks)))
    return sorted(result, key=lambda d: d["path"])


def validate(data):
    if not isinstance(data, dict) or not {"cards", "notes", "assignments"} <= set(data) or set(data) - {"cards", "notes", "assignments", "nextNumber"}: raise ValueError("카드·메모 형식 오류")
    if type(data.get("nextNumber", 1)) is not int or data.get("nextNumber", 1) < 1: raise ValueError("다음 카드 번호 오류")
    numbers = set()
    def members(values):
        if not isinstance(values, list) or any(v not in MEMBERS for v in values) or len(set(values)) != len(values):
            raise ValueError("담당자 형식 오류")
    assignments = data["assignments"]
    if not isinstance(assignments, dict) or len(assignments) > 2000: raise ValueError("계획 담당 형식 오류")
    for path, values in assignments.items():
        if not isinstance(path, str) or not path.startswith("docs/plans/") or not path.endswith(".md") or ".." in path or "\\" in path:
            raise ValueError("계획 경로 오류")
        members(values)
    for kind in ("cards", "notes"):
        items = data[kind]
        if not isinstance(items, list) or len(items) > 2000: raise ValueError("항목 수 제한 초과")
        ids = set()
        for item in items:
            if not isinstance(item, dict): raise ValueError("항목 형식 오류")
            for key, limit in (("id", 100), ("title", 160), ("body", 20000), ("source", 300), ("updated", 80)):
                if not isinstance(item.get(key), str) or len(item[key]) > limit: raise ValueError("필드 오류: " + key)
            if not item["id"] or item["id"] in ids or not item["title"].strip(): raise ValueError("제목 또는 식별자 오류")
            ids.add(item["id"])
            if kind == "cards":
                number = item.get("number")
                if number is not None:
                    if not isinstance(number, str) or not re.fullmatch(r"GP-\d{4,}", number) or number in numbers: raise ValueError("작업 번호 중복 또는 형식 오류")
                    numbers.add(number)
                if item.get("category", "데브옵스") not in CATEGORIES: raise ValueError("작업 분야 오류")
                if type(item.get("priority", 0)) is not int or item.get("priority", 0) not in range(4): raise ValueError("별 중요도 오류")
                if type(item.get("size", 1)) is not int or item.get("size", 1) not in (1, 2, 3): raise ValueError("작업 규모 오류")
                if type(item.get("order", 0)) is not int or item.get("order", 0) < 0: raise ValueError("진행 순서 오류")
                for field, limit in (("priorityNote", 500), ("evidence", 4000), ("performedBy", 160)):
                    if not isinstance(item.get(field, ""), str) or len(item.get(field, "")) > limit: raise ValueError("작업 근거 필드 오류")
                deps = item.get("dependsOn", [])
                if not isinstance(deps, list) or any(not isinstance(d, str) or not re.fullmatch(r"GP-\d{4,}", d) for d in deps) or len(deps) != len(set(deps)): raise ValueError("선행 작업 형식 오류")
                log = item.get("log", [])
                if not isinstance(log, list) or len(log) > 1000: raise ValueError("작업 기록 형식 오류")
                for entry in log:
                    if not isinstance(entry, dict) or entry.get("kind") not in ("user", "ai"): raise ValueError("기록 작성자 구분 오류")
                    for field, limit in (("at", 80), ("by", 160), ("text", 4000)):
                        if not isinstance(entry.get(field), str) or len(entry[field]) > limit: raise ValueError("작업 기록 필드 오류")
            if item.get("status") not in STATUSES: raise ValueError("상태 오류")
            members(item.get("assignees"))
            if item.get("author") not in ("",) + MEMBERS: raise ValueError("작성자 오류")
            for key, limit in (("result", 20000), ("agent", 160)):
                if not isinstance(item.get(key), str) or len(item[key]) > limit: raise ValueError("처리 결과 형식 오류")
    graph = {c["number"]: c.get("dependsOn", []) for c in data["cards"] if c.get("number")}
    visiting, visited = set(), set()
    def visit(number):
        if number in visiting: raise ValueError("선행 작업에 순환 관계가 있습니다.")
        if number in visited: return
        if number not in graph: raise ValueError("존재하지 않는 선행 작업: " + number)
        visiting.add(number)
        for dependency in graph[number]: visit(dependency)
        visiting.remove(number)
        visited.add(number)
    for number in graph: visit(number)


def read_store():
    raw = STORE.read_bytes() if STORE.exists() else b'{"cards":[],"notes":[],"assignments":{}}'
    data = json.loads(raw)
    validate(data)
    return data, hashlib.sha256(raw).hexdigest()


def prepare_cards(data, previous, actor="user", by="사용자", message=""):
    """Allocate under the write lock; never recycle deleted numbers or rewrite history."""
    old = {c["id"]: c for c in previous["cards"]}
    reserved = {c["number"] for c in previous["cards"] if c.get("number")}
    next_number = max(previous.get("nextNumber", 1), data.get("nextNumber", 1),
                      max((int(n[3:]) + 1 for n in reserved), default=1))
    stamp = datetime.now(timezone.utc).isoformat()
    for card in data["cards"]:
        before = old.get(card["id"])
        if before and before.get("number"):
            if card.get("number", before["number"]) != before["number"]: raise ValueError("기존 작업 번호는 변경할 수 없습니다.")
            card["number"] = before["number"]
        else:
            requested = card.get("number")
            if requested and (requested in reserved or int(requested[3:]) < previous.get("nextNumber", 1)):
                raise ValueError("백업 작업 번호가 기존/사용했던 번호와 충돌합니다. 임의로 재번호하지 않습니다.")
            if not requested:
                while f"GP-{next_number:04d}" in reserved: next_number += 1
                card["number"] = f"GP-{next_number:04d}"
            reserved.add(card["number"])
            next_number = max(next_number, int(card["number"][3:]) + 1)
        card.setdefault("category", "데브옵스")
        for key, default in (("priority", 0), ("size", 1), ("order", int(card["number"][3:])), ("dependsOn", []), ("priorityNote", ""), ("evidence", ""), ("performedBy", "")):
            card.setdefault(key, default)
        if card["status"] == "completed" and before and before["status"] != "completed" and not card["evidence"].strip():
            raise ValueError("완료한 내용과 검증·커밋 등 완료 근거를 기록하세요. 담당 배정은 필수가 아닙니다.")
        card["log"] = list(before.get("log", [])) if before else list(card.get("log", []))
        changed = not before or any(card.get(k) != before.get(k) for k in ("title", "body", "status", "source", "assignees", "category", "result", "priority", "size", "order", "dependsOn", "priorityNote", "evidence", "performedBy"))
        if changed or (message and card.get("updated") != (before or {}).get("updated")):
            card["log"].append(dict(at=stamp, by=by, kind=actor, text=message or ("작업 등록" if not before else "작업 내용·상태 수정")))
            card["updated"] = stamp
    data["nextNumber"] = next_number
    validate(data)
    return data


def validate_ai(by):
    team = json.loads((HERE / "team.json").read_text(encoding="utf-8"))
    valid = {f"{p.get('aiPrefix') or p['github']}_{suffix}" for p in team if p["github"] for suffix in ("GPT", "CL")}
    if by not in valid: raise ValueError("AI 표기는 GitHub계정_GPT 또는 GitHub계정_CL입니다. 우진: Lellon_GPT / Lellon_CL. 미등록 계정은 team.json에 먼저 확인·등록하세요.")


def author_member(name, email, team, known_emails=None):
    matches = set()
    username = email.split("@", 1)[0].split("+")[-1].casefold() if email.lower().endswith("@users.noreply.github.com") else ""
    for member in team:
        if not member["github"]: continue
        if name.casefold() in [a.casefold() for a in member["aliases"]] or username == member["github"].casefold():
            matches.add(member["name"])
    matches.update((known_emails or {}).get(email.casefold(), set()))
    return next(iter(matches)) if len(matches) == 1 else None


def git_activity():
    team = json.loads((HERE / "team.json").read_text(encoding="utf-8"))
    result = subprocess.run(["git", "log", "-100", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"], cwd=ROOT,
                            capture_output=True, timeout=10, check=True)
    commits = []
    for record in result.stdout.decode("utf-8", errors="replace").split("\x1e"):
        fields = record.strip().split("\x1f", 4)
        if len(fields) == 5: commits.append(dict(zip(("hash", "author", "email", "date", "subject"), fields)))
    known_emails = {}
    for commit in commits:
        member = author_member(commit["author"], commit["email"], team)
        if member and commit["email"]: known_emails.setdefault(commit["email"].casefold(), set()).add(member)
    for commit in commits:
        commit["member"] = author_member(commit["author"], commit["email"], team, known_emails)
        commit.pop("email")
    return dict(team=team, commits=commits, limit=100)


class Handler(BaseHTTPRequestHandler):
    def send(self, status, value, mime="application/json; charset=utf-8"):
        raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        return self.headers.get("Host") in hosts

    def do_GET(self):
        if not self.allowed(): return self.send(403, {"error": "로컬 주소로 접속하세요."})
        path = urlsplit(self.path).path
        try:
            if path == "/api/health": return self.send(200, {"app": IDENTITY, "root": str(ROOT)})
            if path == "/api/documents": return self.send(200, {"documents": documents()})
            if path == "/api/activity": return self.send(200, git_activity())
            if path == "/api/collaboration":
                import collaboration
                return self.send(200, collaboration.inspect())
            if path == "/api/workspace":
                with LOCK: data, version = read_store()
                return self.send(200, {"data": data, "version": version})
            assets = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
            assets["/fonts/PretendardVariable.woff2"] = ("fonts/PretendardVariable.woff2", "font/woff2")
            assets["/fonts/LICENSE.txt"] = ("fonts/LICENSE.txt", "text/plain")
            if path in assets:
                file, mime = assets[path]
                return self.send(200, (HERE / file).read_bytes(), mime + "; charset=utf-8")
            self.send(404, {"error": "페이지를 찾을 수 없습니다."})
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            self.send(500, {"error": "파일을 읽지 못했습니다. 원본을 보존하고 확인하세요: " + str(error)})

    def do_POST(self):
        if not self.allowed() or self.headers.get("Origin") != "http://" + self.headers.get("Host", ""):
            return self.send(403, {"error": "같은 로컬 관리판에서만 저장할 수 있습니다."})
        if self.path != "/api/workspace": return self.send(404, {"error": "없는 API"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 2_000_000: return self.send(413, {"error": "저장 크기 제한 초과"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict): raise ValueError("저장 요청 형식 오류")
            validate(payload.get("data"))
            with LOCK:
                previous, version = read_store()
                if payload.get("version") != version:
                    return self.send(409, {"error": "다른 창이나 파일에서 수정됐습니다. 입력은 보존했습니다. 창을 닫고 새로고침한 뒤 다시 적용하세요."})
                actor = payload.get("actor", "user")
                by = payload.get("by", "사용자")
                message = payload.get("message", "")
                if actor not in ("user", "ai") or not isinstance(by, str) or len(by) > 160 or not isinstance(message, str) or len(message) > 4000: raise ValueError("기록 입력 오류")
                if actor == "ai": validate_ai(by)
                prepare_cards(payload["data"], previous, actor, by, message)
                raw = (json.dumps(payload["data"], ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                temp = STORE.with_suffix(".tmp")
                temp.write_bytes(raw)
                os.replace(temp, STORE)
                self.send(200, {"data": payload["data"], "version": hashlib.sha256(raw).hexdigest()})
        except (ValueError, OSError) as error:
            self.send(400, {"error": "저장하지 못했습니다: " + str(error)})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"GoodPose board: http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__": main()
