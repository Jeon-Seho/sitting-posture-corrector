"""Check repository knowledge links and obvious sensitive artifact paths offline."""

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "AGENTS.md", "README.md", "Makefile", "requirements-dev.txt",
    "frontend/AGENTS.md", "backend/AGENTS.md", "model/AGENTS.md", "database/AGENTS.md",
    "docs/index.md", "docs/product-spec.md", "docs/architecture.md",
    "docs/development.md", "docs/quality.md", "docs/research/protocol.md",
    "docs/decisions/0001-repository-harness.md", "docs/plans/template.md",
    "docs/plans/backlog.md", "docs/plans/active", "docs/plans/completed",
    "docs/references/README.md", "docs/references/posture_ai_project_one_page.md",
    "docs/references/posture_ai_paper_one_page.md", "contracts/README.md",
    "contracts/posture-status.v1.schema.json", "contracts/examples/normal.json",
    "contracts/examples/deviation.json", "contracts/examples/unmeasurable.json",
    "tools/check_repository.py", "tools/validate_contract.py",
    "tests/test_contracts.py", "tests/test_repository.py", ".github/workflows/harness.yml",
)
PRIVATE_ROOTS = {"data", "artifacts", "runs", "checkpoints"}
PRIVATE_SUFFIXES = {
    ".mp4", ".mov", ".avi", ".webm", ".pt", ".pth", ".onnx", ".tflite",
    ".task", ".npy", ".npz", ".parquet", ".pkl", ".pickle", ".sqlite", ".sqlite3",
    ".db", ".pem", ".key",
}
LINK = re.compile(r"\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+\"[^\"]*\")?\)")


def repository_files(root):
    """Include tracked (even ignored) and untracked, nonignored files."""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root, check=True, stdout=subprocess.PIPE,
    )
    return sorted(set(Path(p) for p in result.stdout.decode("utf-8").split("\0") if p))


def artifact_problem(path):
    if path.parts[:2] == ("database", "temp") or (path.name.startswith("posture-pilot-") and path.suffix.lower() == ".csv"):
        return "local participant capture/analysis must stay outside Git"
    if path.parts[0] in PRIVATE_ROOTS:
        return "private data/artifact directory must stay outside Git"
    if path.suffix.lower() in PRIVATE_SUFFIXES:
        return "data, weight, database or credential artifact must stay outside Git"
    if path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example"):
        return "environment file must stay outside Git"
    return None


def markdown_problems(root, path):
    """Check local inline link targets; remote URLs and heading anchors are not checked."""
    text = (root / path).read_text(encoding="utf-8")
    text = re.sub(r"^\s*(`{3,}|~{3,}).*?^\s*\1\s*$", "", text, flags=re.M | re.S)
    problems = []
    for raw in LINK.findall(text):
        url = urlsplit(raw)
        if url.scheme or url.netloc or not url.path:
            continue
        target = ((root / path).parent / unquote(url.path)).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            problems.append("{}: link escapes repository: {}".format(path, raw))
            continue
        if not target.exists():
            problems.append("{}: broken local link: {}".format(path, raw))
    return problems


def check(root):
    problems = ["missing required path: " + name for name in REQUIRED if not (root / name).exists()]
    for path in repository_files(root):
        issue = artifact_problem(path)
        if issue:
            problems.append("{}: {}".format(path, issue))
        full_path = root / path
        if full_path.is_symlink():
            # Do not read potentially external files through tracked symlinks.
            problems.append("{}: symlinks require an explicit harness policy".format(path))
            continue
        if not full_path.is_file():
            continue
        if path.name == "AGENTS.md" and len(full_path.read_text(encoding="utf-8").splitlines()) > 120:
            problems.append("{}: keep the entry point within 120 lines; move detail to docs".format(path))
        if path.suffix.lower() == ".md":
            problems.extend(markdown_problems(root, path))
    return problems


def main():
    try:
        problems = check(ROOT)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print("Repository check failed: {}".format(error), file=sys.stderr)
        return 1
    if problems:
        for problem in problems:
            print("ERROR: " + problem, file=sys.stderr)
        return 1
    print("PASS: repository structure, local Markdown links and artifact paths")
    return 0


if __name__ == "__main__":
    sys.exit(main())
