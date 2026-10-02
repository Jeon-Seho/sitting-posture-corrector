"""Small, bounded document map for AI sessions; no generated index to go stale."""
import argparse
import json
import re
import sys
from server import documents, CATEGORIES


def main():
    if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", choices=CATEGORIES)
    parser.add_argument("--query", default="")
    parser.add_argument("--task", default="")
    parser.add_argument("--outline", help="Exact repository-relative MD path")
    parser.add_argument("--limit", type=int, default=15)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100: parser.error("limit must be 1..100")
    rows = documents()
    if args.outline:
        doc = next((d for d in rows if d["path"] == args.outline), None)
        if not doc: parser.error("Document not found")
        print(json.dumps(dict(path=doc["path"], categories=doc["groups"], task=doc["task"],
                              headings=[dict(line=i, text=line) for i, line in enumerate(doc["body"].splitlines(), 1) if re.match(r"^#{1,6} ", line)]), ensure_ascii=False, indent=2))
        return
    q = args.query.casefold()
    matches = [d for d in rows if (not args.category or args.category in d["groups"]) and
               (not args.task or d["task"] == args.task.upper()) and
               (not q or q in (d["title"] + d["path"] + d["body"]).casefold())]
    print(json.dumps(dict(total=len(matches), shown=min(len(matches), args.limit), documents=[
        {k: d[k] for k in ("path", "title", "groups", "task", "status")} for d in matches[:args.limit]]), ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
