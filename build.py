import re
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parent
folder = root / "src"
page = (folder / "index.html").read_text(encoding="utf-8")
page = page.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + (folder / "styles.css").read_text(encoding="utf-8") + "\n</style>")
page = page.replace('<meta name="referrer" content="no-referrer">', '<meta name="referrer" content="no-referrer">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">')
license_files = {"jszip.min.js": "JSZip-LICENSE.md", "sax.js": "SAX-LICENSE.md"}

def inline(match):
    name = match[1]
    script = (folder / name).read_text(encoding="utf-8")
    if name in license_files:
        license_text = (folder / license_files[name]).read_text(encoding="utf-8").replace("*/", "* /")
        script = "/*!\n" + license_text + "\n*/\n" + script
    script = re.sub(r"(?i)</script", r"<\\/script", script)
    script = script.replace("<script", "<\\x73cript")
    return "<script>\n" + script + "\n</script>"

scripts = []
page = re.sub(r'<script defer src="([^"]+)"></script>', lambda match: scripts.append(inline(match)) or "", page)
page = page.replace("</body>", "\n" + "\n".join(scripts) + "\n</body>")
target = root / "docs" / "index.html"
target.parent.mkdir(exist_ok=True)
target.write_text(page, encoding="utf-8")
class PageParser(HTMLParser):
    scripts = 0
    def handle_starttag(self, tag, attrs):
        if tag == "script":
            assert not dict(attrs).get("src")
            self.scripts += 1

parsed = PageParser()
parsed.feed(page)
assert parsed.scripts == page.count("</script>") == 5
assert 'src="' not in page.split("<script>")[0]
assert "fetch(" not in (folder / "app.js").read_text(encoding="utf-8")
print(f"Standalone HTML ready, {target.stat().st_size:,} bytes.")
