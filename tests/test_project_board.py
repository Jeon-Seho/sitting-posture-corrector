"""Exercise board persistence, trust boundaries, and live MD status using synthetic files."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import threading
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("project_board_server", Path(__file__).resolve().parents[1] / "tools/project-board/server.py")
board = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(board)
with patch.dict(sys.modules, {"server": board}):
    WORK_SPEC = importlib.util.spec_from_file_location("project_board_work", SPEC.origin.replace("server.py", "work.py"))
    work = importlib.util.module_from_spec(WORK_SPEC)
    WORK_SPEC.loader.exec_module(work)


class WorkflowTests(unittest.TestCase):
    def test_audit_rejects_unregistered_docs_and_uncategorized_work(self):
        card = dict(item(), number="GP-0001", category="프론트", stage="prototype")
        doc = dict(path=card["source"], body="- 분야: 프론트\n- 작업: GP-0001", task="GP-0001", status="")
        self.assertEqual(work.audit({"cards": [card]}, [doc], set()), [])
        doc["task"] = "GP-9999"
        self.assertTrue(any("등록된 작업 번호" in p for p in work.audit({"cards": [card]}, [doc], set())))
        doc["task"] = "GP-0001"
        card["stage"] = "unclassified"
        self.assertTrue(any("프로젝트 단계" in p for p in work.audit({"cards": [card]}, [doc], set())))

    def test_new_user_feedback_reopens_ai_inbox(self):
        card = {"log": [{"kind": "user"}, {"kind": "ai"}]}
        self.assertFalse(work.unseen(card))
        card["log"].append({"kind": "user"})
        self.assertTrue(work.unseen(card))
        card["log"].append({"kind": "ai"})
        self.assertFalse(work.unseen(card))

    def test_stage_is_validated_before_save(self):
        card = dict(item(), stage="does-not-exist")
        with self.assertRaisesRegex(ValueError, "프로젝트 단계"):
            board.validate(dict(cards=[card], notes=[], assignments={}))


def item():
    return dict(id="synthetic-note", title="합성 테스트 요청", body="사용자 원문", source="docs/team.md",
                status="planned", updated="2026-09-29T00:00:00Z", assignees=["우진", "동욱"],
                author="세호", result="", agent="")


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = self.root / "workspace.json"
        self.patch = patch.object(board, "STORE", self.store)
        self.patch.start()
        self.server = board.ThreadingHTTPServer(("127.0.0.1", 0), board.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.patch.stop()
        self.temp.cleanup()

    def request(self, path, payload=None, headers=None):
        request = urllib.request.Request(self.url + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers=headers or ({"Origin": self.url, "Content-Type": "application/json"} if payload is not None else {}))
        try:
            with urllib.request.urlopen(request) as response: return response.status, json.load(response)
        except urllib.error.HTTPError as error: return error.code, json.load(error)

    def test_assignments_and_note_persist_then_stale_save_is_rejected(self):
        data, version = board.read_store()
        data["notes"].append(item())
        data["assignments"]["docs/plans/active/example.md"] = ["유진", "지성", "홍규"]
        status, saved = self.request("/api/workspace", dict(data=data, version=version))
        self.assertEqual(status, 200)
        persisted = board.read_store()[0]
        self.assertEqual(persisted["notes"], data["notes"])
        self.assertEqual(persisted["assignments"], data["assignments"])
        self.assertNotEqual(saved["version"], version)
        other = copy.deepcopy(data)
        other["notes"][0]["body"] = "stale overwrite"
        self.assertEqual(self.request("/api/workspace", dict(data=other, version=version))[0], 409)
        self.assertEqual(board.read_store()[0]["notes"][0]["body"], "사용자 원문")

    def test_cross_origin_and_untrusted_host_cannot_write(self):
        data, version = board.read_store()
        payload = dict(data=data, version=version)
        self.assertEqual(self.request("/api/workspace", payload, {"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.request("/api/workspace", payload, {"Origin": self.url, "Host": "example.com"})[0], 403)
        self.assertFalse(self.store.exists())

    def test_invalid_member_does_not_modify_store(self):
        data, version = board.read_store()
        data["cards"].append(item())
        data["cards"][0]["assignees"] = ["unknown"]
        self.assertEqual(self.request("/api/workspace", dict(data=data, version=version))[0], 400)
        self.assertFalse(self.store.exists())

    def test_corrupt_store_is_not_replaced(self):
        self.store.write_text("broken", encoding="utf-8")
        self.assertEqual(self.request("/api/workspace")[0], 500)
        self.assertEqual(self.request("/api/workspace", dict(data={"cards": [], "notes": [], "assignments": {}}, version="x"))[0], 400)
        self.assertEqual(self.store.read_text(), "broken")

    def test_only_explicit_public_assets_are_served(self):
        for path in ("/.git/config", "/workspace.json", "/../../README.md", "/server.py"):
            with self.subTest(path=path): self.assertEqual(self.request(path)[0], 404)

    def test_completed_checklist_does_not_complete_active_plan(self):
        folder = self.root / "docs/plans/active"
        folder.mkdir(parents=True)
        path = folder / "plan.md"
        path.write_text("# 계획\n\n- 상태: in_progress\n- 담당: FE\n\n- [x] 구현\n", encoding="utf-8")
        doc = board.documents(self.root)[0]
        self.assertEqual((doc["status"], doc["checked"], doc["total"]), ("in_progress", 1, 1))
        path.write_text("# 수정한 계획\n- 상태: blocked\n", encoding="utf-8")
        self.assertEqual(board.documents(self.root)[0]["status"], "blocked")

    def test_completed_folder_and_private_directory_exclusion(self):
        for directory in ("docs/plans/completed", "node_modules", ".git", "outputs", "data"):
            folder = self.root / directory
            folder.mkdir(parents=True)
            (folder / "test.md").write_text("# 테스트\n", encoding="utf-8")
        docs = board.documents(self.root)
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["status"], "completed")

    def test_validator_rejects_duplicate_ids_and_unsafe_assignment_path(self):
        data = {"cards": [], "notes": [item(), item()], "assignments": {}}
        with self.assertRaises(ValueError): board.validate(data)
        data["notes"] = []
        data["assignments"] = {"docs/plans/../../secret.md": ["홍규"]}
        with self.assertRaises(ValueError): board.validate(data)

    def test_author_mapping_is_exact_and_ambiguous_email_is_unlinked(self):
        team = json.loads((board.HERE / "team.json").read_text(encoding="utf-8"))
        self.assertEqual(board.author_member("lellon", "x@example.com", team), "우진")
        self.assertEqual(board.author_member("other", "123+Jeon-Seho@users.noreply.github.com", team), "세호")
        self.assertEqual(board.author_member("Leo", "x@example.com", team), "동욱")
        self.assertEqual(board.author_member("HJisung", "x@example.com", team), "지성")
        # Confirmed by the user on 2026-10-06; a partial spelling stays unlinked.
        self.assertEqual(board.author_member("jisung", "unknown@example.com", team), "지성")
        self.assertEqual(board.author_member("dev-jisung", "unknown@example.com", team), "지성")
        self.assertIsNone(board.author_member("jisung2", "unknown@example.com", team))
        self.assertEqual(board.author_member("ghdrb1246", "unknown@example.com", team), "홍규")
        self.assertEqual(board.author_member("other", "123+sunshine-yj@users.noreply.github.com", team), "유진")
        self.assertIsNone(board.author_member("sunshine", "unknown@example.com", team))
        self.assertIsNone(board.author_member("lellon", "shared@example.com", team, {"shared@example.com": {"우진", "세호"}}))

    def test_new_cards_default_to_members_with_the_confirmed_role(self):
        team = json.loads((board.HERE / "team.json").read_text(encoding="utf-8"))
        self.assertEqual(board.default_assignees("프론트", team), ["우진", "동욱"])
        self.assertEqual(board.default_assignees("머신러닝", team), ["지성"])
        self.assertEqual(board.default_assignees("DB", team), ["유진"])
        for category in ("데브옵스", "백엔드", "서버"):
            self.assertEqual(board.default_assignees(category, team), ["홍규"])
        # PM and paper work have no category default; they are assigned explicitly.
        self.assertEqual(board.default_assignees("논문", team), [])
        self.assertEqual(board.default_assignees("미지정", [{"name": "x"}]), [])

    def test_document_shelves_include_shared_topics(self):
        self.assertIn("프론트", board.groups("frontend/README.md", "프론트"))
        self.assertIn("머신러닝", board.groups("docs/research/protocol.md", "연구 프로토콜"))
        self.assertIn("논문", board.groups("docs/research/protocol.md", "연구 프로토콜"))
        self.assertEqual(board.groups("database/AGENTS.md", "Database 작업 지도"), ["DB"])

    def test_numbers_survive_edits_and_are_not_recycled(self):
        before = {"cards": [], "notes": [], "assignments": {}}
        data = copy.deepcopy(before)
        data["cards"] = [item()]
        board.prepare_cards(data, before)
        self.assertEqual(data["cards"][0]["number"], "GP-0001")
        edited = copy.deepcopy(data)
        edited["cards"][0]["title"] = "changed"
        board.prepare_cards(edited, data)
        self.assertEqual(edited["cards"][0]["number"], "GP-0001")
        deleted = copy.deepcopy(edited)
        deleted["cards"] = []
        board.prepare_cards(deleted, edited)
        replacement = copy.deepcopy(deleted)
        replacement["cards"] = [item()]
        replacement["cards"][0]["id"] = "new"
        board.prepare_cards(replacement, deleted)
        self.assertEqual(replacement["cards"][0]["number"], "GP-0002")

    def test_dependency_cycle_and_missing_target_are_rejected(self):
        a,b=item(),item()
        a.update(id="a",number="GP-0001",dependsOn=["GP-0002"])
        b.update(id="b",number="GP-0002",dependsOn=["GP-0001"])
        data=dict(cards=[a,b],notes=[],assignments={})
        with self.assertRaises(ValueError): board.validate(data)
        b["dependsOn"] = []
        board.validate(data)
        a["dependsOn"] = ["GP-0999"]
        with self.assertRaises(ValueError): board.validate(data)

    def test_completion_requires_evidence_but_not_assignment(self):
        card=item()
        card.update(number="GP-0001",assignees=[])
        before=dict(cards=[card],notes=[],assignments={})
        data=copy.deepcopy(before)
        data["cards"][0]["status"]="completed"
        with self.assertRaises(ValueError): board.prepare_cards(data,before)
        data["cards"][0].update(evidence="합성 회귀 검증 통과",performedBy="동욱")
        board.prepare_cards(data,before,"ai","Lellon_GPT","완료 확인")
        self.assertEqual(data["cards"][0]["status"],"completed")

    def test_ai_identity_requires_confirmed_owner(self):
        board.validate_ai("Lellon_GPT")
        board.validate_ai("klaod-tech_CL")
        for prefix in ("ghdrb1246", "sunshine-yj"):
            for suffix in ("GPT", "CL"): board.validate_ai(prefix + "_" + suffix)
        for name in ("Codex", "GPT", "홍규_GPT"):
            with self.subTest(name=name), self.assertRaises(ValueError): board.validate_ai(name)

    def test_new_document_uses_explicit_category_and_task(self):
        path=self.root / "new.md"
        path.write_text("# DB 설계\n\n- 분야: DB, 백엔드\n- 작업: GP-0031\n",encoding="utf-8")
        doc=board.documents(self.root)[0]
        self.assertEqual(doc["groups"],["DB","백엔드"])
        self.assertEqual(doc["task"],"GP-0031")


if __name__ == "__main__": unittest.main()
