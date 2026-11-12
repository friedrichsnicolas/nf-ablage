"""Dependency-free smoke checks for the accessible PWA entry point."""
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / ("dist/index.html" if (ROOT / "dist/index.html").exists() else "index.html")


class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.main = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a":
            self.links.append(attrs)
        if tag == "main":
            self.main.append(attrs)


page = Elements()
page.feed(ENTRY.read_text(encoding="utf-8"))
assert len(page.main) >= 1, "Expected a main landmark"
assert "main-content" in page.ids, "Missing keyboard navigation target"
assert any(a.get("href") == "#main-content" and a.get("class") == "skip-link" for a in page.links), "Missing skip link"
assert any(a.get("id") == "main-content" and a.get("tabindex") == "-1" for a in page.main), "Main must accept programmatic focus"
print(f"PASS: {ENTRY.relative_to(ROOT)} provides a keyboard skip link")
