"""Unit tests for Atlassian Document Format <-> Markdown conversion."""

from __future__ import annotations

from typing import Any

from jira_dashboard.adapters.adf import adf_to_markdown, markdown_to_adf


def _doc(*content: dict[str, Any]) -> dict[str, Any]:
    return {"type": "doc", "version": 1, "content": list(content)}


def _p(*inline: dict[str, Any]) -> dict[str, Any]:
    return {"type": "paragraph", "content": list(inline)}


def _t(text: str, *marks: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = list(marks)
    return node


def test_paragraphs_are_separated_by_blank_lines() -> None:
    doc = _doc(_p(_t("First")), _p(_t("Second")))
    assert adf_to_markdown(doc) == "First\n\nSecond"


def test_inline_marks() -> None:
    doc = _doc(
        _p(
            _t("a ", {"type": "strong"}),
            _t("b", {"type": "em"}),
            _t(" "),
            _t("c", {"type": "code"}),
            _t(" "),
            _t("d", {"type": "link", "attrs": {"href": "https://x.io"}}),
        )
    )
    assert adf_to_markdown(doc) == "**a** *b* `c` [d](https://x.io)"


def test_hard_break_and_headings() -> None:
    doc = _doc(
        {"type": "heading", "attrs": {"level": 2}, "content": [_t("Title")]},
        _p(_t("one"), {"type": "hardBreak"}, _t("two")),
    )
    assert adf_to_markdown(doc) == "## Title\n\none\ntwo"


def test_lists() -> None:
    def item(text: str) -> dict[str, Any]:
        return {"type": "listItem", "content": [_p(_t(text))]}

    doc = _doc(
        {"type": "bulletList", "content": [item("a"), item("b")]},
        {"type": "orderedList", "content": [item("x"), item("y")]},
    )
    assert adf_to_markdown(doc) == "- a\n- b\n\n1. x\n2. y"


def test_code_block_and_quote() -> None:
    doc = _doc(
        {"type": "codeBlock", "content": [_t("print(1)")]},
        {"type": "blockquote", "content": [_p(_t("wise"))]},
    )
    assert adf_to_markdown(doc) == "```\nprint(1)\n```\n\n> wise"


def test_empty_or_invalid_returns_empty() -> None:
    assert adf_to_markdown(_doc()) == ""
    assert adf_to_markdown({}) == ""


def test_markdown_to_adf_roundtrip() -> None:
    md = (
        "## Title\n\n"
        "Hello **bold** and *it* with `code` [l](https://x.io)\n\n"
        "- a\n- b\n\n"
        "1. x\n2. y\n\n"
        "> q\n\n"
        "```\ncode\n```"
    )
    assert adf_to_markdown(markdown_to_adf(md)) == md


def test_markdown_plain_text_single_paragraph() -> None:
    adf = markdown_to_adf("just text")
    assert adf == _doc(_p(_t("just text")))


def test_markdown_multiline_paragraph_uses_hard_break() -> None:
    adf = markdown_to_adf("one\ntwo")
    assert adf_to_markdown(adf) == "one\ntwo"
    assert adf["content"][0]["content"][1] == {"type": "hardBreak"}
