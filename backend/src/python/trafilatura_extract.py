import json
import sys

try:
    import trafilatura
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"trafilatura_import_failed: {exc}"}))
    sys.exit(0)

html = sys.stdin.read()
if not html:
    print(json.dumps({"ok": False, "error": "empty_html"}))
    sys.exit(0)

try:
    text = trafilatura.extract(html, include_comments=False, include_tables=False)
    if not text:
        print(json.dumps({"ok": False, "error": "no_text"}))
    else:
        print(json.dumps({"ok": True, "text": text}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"extract_failed: {exc}"}))
