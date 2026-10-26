"""Unit tests for the release automation script (scripts/release.py)."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure scripts directory is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from release import (  # noqa: E402
    VersionBumpType,
    compute_next_version,
    generate_changelog_entry,
    parse_current_version,
    update_all_version_files,
)


class TestReleaseScript(unittest.TestCase):
    """Test suite for release.py functions."""

    def test_compute_next_version_patch(self) -> None:
        self.assertEqual(compute_next_version("0.9.0", VersionBumpType.PATCH), "0.9.1")
        self.assertEqual(compute_next_version("1.2.3", VersionBumpType.PATCH), "1.2.4")

    def test_compute_next_version_minor(self) -> None:
        self.assertEqual(compute_next_version("0.9.0", VersionBumpType.MINOR), "0.10.0")
        self.assertEqual(compute_next_version("1.2.3", VersionBumpType.MINOR), "1.3.0")

    def test_compute_next_version_major(self) -> None:
        self.assertEqual(compute_next_version("0.9.0", VersionBumpType.MAJOR), "1.0.0")
        self.assertEqual(compute_next_version("1.2.3", VersionBumpType.MAJOR), "2.0.0")

    def test_parse_current_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            config_yaml = Path(tmpdir) / "addon" / "config.yaml"
            config_yaml.parent.mkdir(parents=True)
            config_yaml.write_text(
                'name: "Jira Dashboard"\nversion: "0.9.0"\nslug: "jira_dashboard"\n'
            )
            v = parse_current_version(Path(tmpdir))
            self.assertEqual(v, "0.9.0")

    def test_generate_changelog_entry(self) -> None:
        notes = "- Feature A\n- Feature B"
        entry = generate_changelog_entry("0.10.0", notes)
        self.assertIn("## 0.10.0", entry)
        self.assertIn("- Feature A", entry)
        self.assertIn("- Feature B", entry)

    def test_update_all_version_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # Create mock structure
            addon_config = root / "addon" / "config.yaml"
            addon_config.parent.mkdir(parents=True)
            addon_config.write_text('name: "Jira Dashboard"\nversion: "0.9.0"\n')

            addon_build = root / "addon" / "build.yaml"
            addon_build.write_text('args:\n  BUILD_VERSION: "0.9.0"\n')

            addon_changelog = root / "addon" / "CHANGELOG.md"
            addon_changelog.write_text("# Changelog\n\n## 0.9.0\n\n- Previous change\n")

            pyproject = root / "backend" / "pyproject.toml"
            pyproject.parent.mkdir(parents=True)
            pyproject.write_text('[project]\nname = "jira-dashboard-backend"\nversion = "0.9.0"\n')

            init_py = root / "backend" / "src" / "jira_dashboard" / "__init__.py"
            init_py.parent.mkdir(parents=True)
            init_py.write_text('"""Init."""\n\n__version__ = "0.9.0"\n')

            jira_client = (
                root / "backend" / "src" / "jira_dashboard" / "adapters" / "jira_cloud_client.py"
            )
            jira_client.parent.mkdir(parents=True)
            jira_client.write_text('User-Agent: "HomeAssistant-JiraDashboard/0.9.0"\n')

            main_py = root / "backend" / "src" / "jira_dashboard" / "presentation" / "main.py"
            main_py.parent.mkdir(parents=True)
            main_py.write_text('app = FastAPI(\n    version="0.9.0",\n)\n')

            pkg_test = root / "backend" / "tests" / "test_packaging_and_addon.py"
            pkg_test.parent.mkdir(parents=True)
            pkg_test.write_text(
                'assert config["version"] == "0.9.0"\nassert "0.9.0" in changelog_text\n'
            )

            ph_test = root / "backend" / "tests" / "test_placeholder.py"
            ph_test.write_text('self.assertEqual(jira_dashboard.__version__, "0.9.0")\n')

            pkg_json = root / "frontend" / "package.json"
            pkg_json.parent.mkdir(parents=True)
            pkg_json.write_text(
                '{\n  "name": "jira-dashboard-frontend",\n  "version": "0.9.0"\n}\n'
            )

            version_ts = root / "frontend" / "src" / "utils" / "version.ts"
            version_ts.parent.mkdir(parents=True)
            version_ts.write_text(
                "export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' "
                "? __APP_VERSION__ : '0.9.0';\n"
            )

            version_test_ts = root / "frontend" / "src" / "utils" / "version.test.ts"
            version_test_ts.write_text("expect(APP_VERSION).toBe('0.9.0');\n")

            settings_test = root / "frontend" / "src" / "components" / "SettingsView.test.tsx"
            settings_test.parent.mkdir(parents=True)
            settings_test.write_text(
                "version: '0.9.0'\n"
                "expect(versionBadge?.textContent).toContain('0.9.0');\n"
                "version: '1.0.0'\n"
                "expect(backendBadge?.textContent).toContain('1.0.0');\n"
            )

            # Execute update
            modified = update_all_version_files(
                root=root,
                current_version="0.9.0",
                new_version="0.10.0",
                changelog_notes="- New feature X\n- Bugfix Y",
            )

            self.assertEqual(len(modified), 13)

            # Verify contents
            self.assertIn('version: "0.10.0"', addon_config.read_text())
            self.assertIn('BUILD_VERSION: "0.10.0"', addon_build.read_text())
            self.assertIn("## 0.10.0", addon_changelog.read_text())
            self.assertIn("- New feature X", addon_changelog.read_text())
            self.assertIn('version = "0.10.0"', pyproject.read_text())
            self.assertIn('__version__ = "0.10.0"', init_py.read_text())
            self.assertIn("HomeAssistant-JiraDashboard/0.10.0", jira_client.read_text())
            self.assertIn('version="0.10.0"', main_py.read_text())
            self.assertIn('assert config["version"] == "0.10.0"', pkg_test.read_text())
            self.assertIn('assert "0.10.0" in changelog_text', pkg_test.read_text())
            self.assertIn(
                'self.assertEqual(jira_dashboard.__version__, "0.10.0")', ph_test.read_text()
            )
            self.assertIn('"version": "0.10.0"', pkg_json.read_text())
            self.assertIn("'0.10.0'", version_ts.read_text())
            self.assertIn("'0.10.0'", version_test_ts.read_text())
            self.assertIn("version: '0.10.0'", settings_test.read_text())
            self.assertIn(
                "expect(versionBadge?.textContent).toContain('0.10.0');",
                settings_test.read_text(),
            )

    def test_compute_next_version_invalid(self) -> None:
        with self.assertRaises(ValueError):
            compute_next_version("invalid", VersionBumpType.PATCH)
        with self.assertRaises(ValueError):
            compute_next_version("1.0", VersionBumpType.MINOR)

    def test_cli_dry_run(self) -> None:
        cmd = [sys.executable, str(PROJECT_ROOT / "scripts" / "release.py"), "--dry-run"]
        res = subprocess.run(cmd, cwd=PROJECT_ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("Dry-run mode enabled", res.stdout)
        self.assertIn("Target Version:", res.stdout)


if __name__ == "__main__":
    unittest.main()
