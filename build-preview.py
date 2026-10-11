#!/usr/bin/env python3
"""Build the self-contained teacher-enabled preview. Run: python3 build-preview.py."""
from pathlib import Path
import base64
import json
import re

ROOT = Path(__file__).resolve().parent


def safe_inline(source: str, tag: str) -> str:
    """Prevent source text from terminating its enclosing HTML raw-text element."""
    source = re.sub(r"</" + tag, lambda match: "<\\/" + tag, source, flags=re.IGNORECASE)
    if tag == "script":
        # htmlpreview scans raw HTML with a script-tag regex. The only opening
        # script text in app.js is inside exportStudent's template literal;
        # a JavaScript escape keeps its runtime value while hiding it from that scan.
        source = re.sub(r"<script\b", lambda match: "\\x3c" + match.group(0)[1:], source, flags=re.IGNORECASE)
    return source


def build() -> Path:
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    curriculum = (ROOT / "curriculum.js").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    pet_data = "data:image/webp;base64," + base64.b64encode((ROOT / "assets/pet.webp").read_bytes()).decode("ascii")

    # Keep the original metadata and boot screen; replace only known source includes.
    style_link = '<link rel="stylesheet" href="styles.css">'
    if index.count(style_link) != 1:
        raise ValueError("Expected exactly one styles.css include in index.html")
    index = index.replace(style_link, "<style>\n" + safe_inline(css, "style") + "\n</style>")
    for filename in ("curriculum.js", "app.js"):
        include = f'<script src="{filename}" defer></script>'
        if index.count(include) != 1:
            raise ValueError(f"Expected exactly one {filename} include in index.html")
        index = index.replace(include, "")

    asset_script = "window.PET_ASSET=" + json.dumps(pet_data) + ";"
    scripts = (
        "\n    <!-- Self-contained preview; teacher mode remains enabled. -->\n"
        "    <script>" + safe_inline(asset_script, "script") + "</script>\n"
        "    <script>\n" + safe_inline(curriculum, "script") + "\n</script>\n"
        "    <script>\n" + safe_inline(app, "script") + "\n</script>\n"
    )
    if index.count("</body>") != 1:
        raise ValueError("Expected exactly one body closing tag in index.html")
    output = ROOT / "play.html"
    output.write_text(index.replace("</body>", scripts + "  </body>"), encoding="utf-8")
    return output


if __name__ == "__main__":
    output = build()
    print(f"Built {output.name} ({output.stat().st_size:,} bytes)")
