"""Pytest configuration ensuring backend unit and integration tests run isolated."""

from __future__ import annotations

import os

# Guarantee test runs use FakeJiraClient test double unless explicitly overridden
os.environ["JIRA_USE_FAKE"] = "1"
