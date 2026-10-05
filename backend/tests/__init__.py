"""Backend test suite."""

import os

# Ensure all backend tests run in fake double mode by default
os.environ.setdefault("JIRA_USE_FAKE", "1")
