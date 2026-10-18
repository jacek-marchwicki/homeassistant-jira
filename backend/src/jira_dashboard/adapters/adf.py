"""Conversion between Atlassian Document Format (ADF) and Markdown.

Jira Cloud stores rich descriptions as ADF JSON. The dashboard edits and renders
Markdown, so descriptions are converted to Markdown on read and back to ADF on write,
preserving paragraphs, headings, lists, code blocks, quotes and inline formatting.
"""

from __future__ import annotations

import re
from typing import Any

_INLINE_RE = re.compile(
    r"\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~"
)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)$")
_ORDERED_RE = re.compile(r"^\s*\d+\.\s+(.*)$")
_QUOTE_RE = re.compile(r"^>\s?(.*)$")


# --------------------------------------------------------------------------- ADF -> MD


def _wrap_mark(text: str, marker: str) -> str:
    """Wrap text in a Markdown marker, keeping surrounding whitespace outside it."""
    stripped = text.strip()
    if not stripped:
        return text
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()) :]
    return f"{lead}{marker}{stripped}{marker}{trail}"


def _inline_text(node: dict[str, Any]) -> str:
    text = str(node.get("text", ""))
    for mark in node.get("marks", []) or []:
        mtype = mark.get("type")
        if mtype == "strong":
            text = _wrap_mark(text, "**")
        elif mtype == "em":
            text = _wrap_mark(text, "*")
        elif mtype == "strike":
            text = _wrap_mark(text, "~~")
        elif mtype == "code":
            text = _wrap_mark(text, "`")
        elif mtype == "link":
            href = (mark.get("attrs") or {}).get("href")
            if href and text.strip():
                text = f"[{text}]({href})"
    return text


def _inline(nodes: list[Any]) -> str:
    out: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        ntype = node.get("type")
        attrs = node.get("attrs") or {}
        if ntype == "text":
            out.append(_inline_text(node))
        elif ntype == "hardBreak":
            out.append("\n")
        elif ntype == "mention":
            out.append(str(attrs.get("text") or ""))
        elif ntype == "emoji":
            out.append(str(attrs.get("text") or attrs.get("shortName") or ""))
        elif ntype == "inlineCard":
            out.append(str(attrs.get("url") or ""))
        elif ntype == "status":
            out.append(str(attrs.get("text") or ""))
        elif node.get("content"):
            out.append(_inline(node["content"]))
    return "".join(out)


def _block(node: dict[str, Any], indent: str = "") -> str:
    ntype = node.get("type")
    children = node.get("content") or []
    if ntype == "paragraph":
        return _inline(children)
    if ntype == "heading":
        level = min(max(int((node.get("attrs") or {}).get("level", 1)), 1), 6)
        return f"{'#' * level} {_inline(children)}"
    if ntype in ("bulletList", "orderedList"):
        lines: list[str] = []
        for index, item in enumerate(children, start=1):
            marker = "- " if ntype == "bulletList" else f"{index}. "
            parts = [_block(c, indent + "  ") for c in item.get("content") or []]
            parts = [p for p in parts if p]
            if not parts:
                continue
            lines.append(f"{indent}{marker}{parts[0].lstrip()}")
            lines.extend(parts[1:])
        return "\n".join(lines)
    if ntype == "codeBlock":
        return f"```\n{_inline(children)}\n```"
    if ntype == "blockquote":
        inner = _blocks(children)
        return "\n".join(f"> {line}" if line else ">" for line in inner.split("\n"))
    if ntype == "rule":
        return "---"
    if ntype in ("panel", "expand", "table", "tableRow", "tableHeader", "tableCell", "taskList"):
        return _blocks(children)
    if ntype == "taskItem":
        done = (node.get("attrs") or {}).get("state") == "DONE"
        return f"- [{'x' if done else ' '}] {_inline(children)}"
    if children:
        return _blocks(children)
    return ""


def _blocks(nodes: list[Any]) -> str:
    rendered = [_block(n) for n in nodes if isinstance(n, dict)]
    return "\n\n".join(r for r in rendered if r)


def adf_to_markdown(doc: dict[str, Any]) -> str:
    """Convert an ADF document into Markdown text (empty string if nothing to render)."""
    if not isinstance(doc, dict):
        return ""
    return _blocks(doc.get("content") or []).strip()


# --------------------------------------------------------------------------- MD -> ADF


def _text_node(text: str, *marks: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = list(marks)
    return node


def _inline_nodes(text: str) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    last = 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > last:
            nodes.append(_text_node(text[last : m.start()]))
        if m.group(1) is not None:
            nodes.append(
                _text_node(m.group(1), {"type": "link", "attrs": {"href": m.group(2).strip()}})
            )
        elif m.group(3) is not None:
            nodes.append(_text_node(m.group(3), {"type": "code"}))
        elif m.group(4) is not None:
            nodes.append(_text_node(m.group(4), {"type": "strong"}))
        elif m.group(5) is not None:
            nodes.append(_text_node(m.group(5), {"type": "em"}))
        else:
            nodes.append(_text_node(m.group(6), {"type": "strike"}))
        last = m.end()
    if last < len(text):
        nodes.append(_text_node(text[last:]))
    return nodes


def _paragraph(lines: list[str]) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        if index:
            content.append({"type": "hardBreak"})
        content.extend(_inline_nodes(line))
    return {"type": "paragraph", "content": content}


def markdown_to_adf(markdown: str) -> dict[str, Any]:
    """Convert Markdown text into an ADF document."""
    blocks: list[dict[str, Any]] = []
    paragraph: list[str] = []
    list_node: dict[str, Any] | None = None
    quote: list[str] = []

    def flush() -> None:
        nonlocal paragraph, list_node, quote
        if paragraph:
            blocks.append(_paragraph(paragraph))
            paragraph = []
        if list_node is not None:
            blocks.append(list_node)
            list_node = None
        if quote:
            blocks.append({"type": "blockquote", "content": [_paragraph(quote)]})
            quote = []

    lines = markdown.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if line.strip() in ("---", "***", "___"):
            flush()
            blocks.append({"type": "rule"})
            continue
        if line.strip().startswith("```"):
            flush()
            code: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # closing fence
            node: dict[str, Any] = {"type": "codeBlock"}
            if code:
                node["content"] = [_text_node("\n".join(code))]
            blocks.append(node)
            continue
        if not line.strip():
            flush()
            continue
        heading = _HEADING_RE.match(line)
        if heading:
            flush()
            blocks.append(
                {
                    "type": "heading",
                    "attrs": {"level": len(heading.group(1))},
                    "content": _inline_nodes(heading.group(2)),
                }
            )
            continue
        bullet = _BULLET_RE.match(line)
        ordered = None if bullet else _ORDERED_RE.match(line)
        if bullet or ordered:
            wanted = "bulletList" if bullet else "orderedList"
            if list_node is not None and list_node["type"] != wanted:
                flush()
            if paragraph or quote:
                flush()
            if list_node is None:
                list_node = {"type": wanted, "content": []}
            text = (bullet or ordered).group(1)  # type: ignore[union-attr]
            list_node["content"].append({"type": "listItem", "content": [_paragraph([text])]})
            continue
        quoted = _QUOTE_RE.match(line)
        if quoted:
            if paragraph or list_node is not None:
                flush()
            quote.append(quoted.group(1))
            continue
        if list_node is not None or quote:
            flush()
        paragraph.append(line)
    flush()
    return {"type": "doc", "version": 1, "content": blocks}
