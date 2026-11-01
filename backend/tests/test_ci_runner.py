"""Unit tests for the local CI runner script (scripts/run_ci_locally.py)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

# Ensure scripts directory is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from run_ci_locally import (  # noqa: E402
    build_parser,
    format_duration,
    validate_ci_workflow,
)


class TestCIRunnerScript(unittest.TestCase):
    """Test suite for run_ci_locally.py functions."""

    def test_format_duration(self) -> None:
        self.assertEqual(format_duration(0.045), "45ms")
        self.assertEqual(format_duration(1.234), "1.23s")

    def test_validate_ci_workflow_valid(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            wf = Path(tmpdir) / "ci.yml"
            wf.write_text(
                "name: CI\n"
                "jobs:\n"
                "  backend:\n    runs-on: ubuntu-latest\n"
                "  frontend:\n    runs-on: ubuntu-latest\n"
                "  e2e-and-visual:\n    runs-on: ubuntu-latest\n"
                "  android:\n    runs-on: ubuntu-latest\n",
                encoding="utf-8",
            )
            # Should not raise
            validate_ci_workflow(wf)

    def test_validate_ci_workflow_missing_android(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            wf = Path(tmpdir) / "ci.yml"
            wf.write_text(
                "name: CI\n"
                "jobs:\n"
                "  backend:\n    runs-on: ubuntu-latest\n"
                "  frontend:\n    runs-on: ubuntu-latest\n"
                "  e2e-and-visual:\n    runs-on: ubuntu-latest\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as ctx:
                validate_ci_workflow(wf)
            self.assertIn("android", str(ctx.exception))

    def test_validate_real_ci_workflow(self) -> None:
        real_ci = PROJECT_ROOT / ".github" / "workflows" / "ci.yml"
        self.assertTrue(real_ci.exists(), f"{real_ci} does not exist")
        # Must validate without error
        validate_ci_workflow(real_ci)

    def test_build_parser_android_flags(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["--skip-android"])
        self.assertTrue(args.skip_android)

        args = parser.parse_args(["--android"])
        self.assertTrue(args.run_android_only)

    def test_build_parser_act_android_job(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["--act", "-j", "android"])
        self.assertTrue(args.use_act)
        self.assertEqual(args.job, "android")
