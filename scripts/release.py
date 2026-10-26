#!/usr/bin/env python3
"""Release Automation CLI for Home Assistant Jira Dashboard.

Automates the complete dual-deployment release lifecycle:
1. Version bumping across all 13 package and metadata files:
   - Home Assistant Add-on config and build manifests
   - Python backend pyproject.toml and package metadata
   - Frontend package.json and PWA version constants
   - Add-on changelog and test suite version assertions
2. Automated changelog and release notes generation from Git history
3. Fast pre-release local CI pipeline verification (100% tests & quality)
4. Git commit and annotated tag creation
5. GitHub push and GitHub Release creation (triggering multi-arch GHCR image builds)
6. Google Cloud Platform (GCP Cloud Run) deployment with Secret Manager & Firestore persistence
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import time
from enum import Enum
from pathlib import Path

# Terminal ANSI color codes
GREEN = "\033[0;32m"
RED = "\033[0;31m"
BLUE = "\033[0;34m"
YELLOW = "\033[1;33m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"  # No Color


class VersionBumpType(str, Enum):
    PATCH = "patch"
    MINOR = "minor"
    MAJOR = "major"


def print_step(msg: str) -> None:
    """Print formatted step banner."""
    print(f"\n{BLUE}{BOLD}==> {msg}{NC}")


def print_success(msg: str) -> None:
    """Print success message."""
    print(f"{GREEN}✓ {msg}{NC}")


def print_warning(msg: str) -> None:
    """Print warning message."""
    print(f"{YELLOW}⚠ {msg}{NC}")


def print_error(msg: str) -> None:
    """Print error message."""
    print(f"{RED}✗ {msg}{NC}")


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Execute a system command with error reporting."""
    try:
        return subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            check=check,
            capture_output=capture_output,
        )
    except subprocess.CalledProcessError as exc:
        print_error(f"Command failed: {' '.join(cmd)}")
        if exc.stdout:
            print(f"Stdout:\n{exc.stdout}")
        if exc.stderr:
            print(f"Stderr:\n{exc.stderr}")
        raise


def parse_current_version(root: Path) -> str:
    """Read current version from addon/config.yaml or backend __init__.py."""
    config_file = root / "addon" / "config.yaml"
    if config_file.is_file():
        content = config_file.read_text(encoding="utf-8")
        match = re.search(r'^version:\s*["\']?([^"\'\s]+)["\']?', content, re.MULTILINE)
        if match:
            return match.group(1)

    init_file = root / "backend" / "src" / "jira_dashboard" / "__init__.py"
    if init_file.is_file():
        content = init_file.read_text(encoding="utf-8")
        match = re.search(
            r'^__version__\s*=\s*["\']([^"\']+)["\']', content, re.MULTILINE
        )
        if match:
            return match.group(1)

    raise ValueError("Unable to determine current version from repository manifests.")


def compute_next_version(current: str, bump: VersionBumpType) -> str:
    """Calculate the next semver version string based on bump type."""
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", current.strip())
    if not match:
        raise ValueError(
            f"Current version '{current}' is not a valid 3-part semver (X.Y.Z)."
        )

    major, minor, patch = map(int, match.groups())
    if bump == VersionBumpType.PATCH:
        return f"{major}.{minor}.{patch + 1}"
    elif bump == VersionBumpType.MINOR:
        return f"{major}.{minor + 1}.0"
    elif bump == VersionBumpType.MAJOR:
        return f"{major + 1}.0.0"
    raise ValueError(f"Unknown bump type: {bump}")


def get_latest_git_tag(root: Path) -> str | None:
    """Retrieve the latest Git tag if available."""
    try:
        res = run_cmd(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=root,
            check=False,
            capture_output=True,
        )
        tag = res.stdout.strip()
        return tag if tag else None
    except (subprocess.SubprocessError, OSError):
        return None


def generate_release_notes(root: Path, last_tag: str | None = None) -> str:
    """Extract conventional commits since the last tag and format as markdown list."""
    if not last_tag:
        last_tag = get_latest_git_tag(root)

    cmd = (
        ["git", "log", f"{last_tag}..HEAD", "--oneline"]
        if last_tag
        else ["git", "log", "-n", "10", "--oneline"]
    )
    res = run_cmd(cmd, cwd=root, check=False, capture_output=True)

    lines = res.stdout.strip().splitlines()
    bullets: list[str] = []
    for line in lines:
        parts = line.strip().split(" ", 1)
        if len(parts) < 2:
            continue
        msg = parts[1].strip()
        # Filter out merge commits and release commits
        if msg.startswith(("Merge branch", "chore(release)")):
            continue
        bullets.append(f"- {msg}")

    if not bullets:
        return "- Maintenance updates and stability improvements."
    return "\n".join(bullets)


def generate_changelog_entry(version: str, notes: str) -> str:
    """Format markdown entry for addon/CHANGELOG.md."""
    clean_notes = notes.strip()
    return f"## {version}\n\n{clean_notes}\n"


def update_all_version_files(
    root: Path,
    current_version: str,
    new_version: str,
    changelog_notes: str,
) -> list[Path]:
    """Atomically update all 13 version files across backend, frontend, and add-on."""
    modified_files: list[Path] = []

    # 1. addon/config.yaml
    addon_config = root / "addon" / "config.yaml"
    if addon_config.is_file():
        text = addon_config.read_text(encoding="utf-8")
        text = re.sub(
            r'^version:\s*["\']?[^"\'\s]+["\']?',
            f'version: "{new_version}"',
            text,
            flags=re.MULTILINE,
        )
        addon_config.write_text(text, encoding="utf-8")
        modified_files.append(addon_config)

    # 2. addon/build.yaml
    addon_build = root / "addon" / "build.yaml"
    if addon_build.is_file():
        text = addon_build.read_text(encoding="utf-8")
        text = re.sub(
            r'BUILD_VERSION:\s*["\']?[^"\'\s]+["\']?',
            f'BUILD_VERSION: "{new_version}"',
            text,
        )
        addon_build.write_text(text, encoding="utf-8")
        modified_files.append(addon_build)

    # 3. addon/CHANGELOG.md
    addon_changelog = root / "addon" / "CHANGELOG.md"
    if addon_changelog.is_file():
        text = addon_changelog.read_text(encoding="utf-8")
        entry = generate_changelog_entry(new_version, changelog_notes)
        if "# Changelog\n\n" in text:
            text = text.replace("# Changelog\n\n", f"# Changelog\n\n{entry}\n")
        else:
            text = f"# Changelog\n\n{entry}\n\n" + text
        addon_changelog.write_text(text, encoding="utf-8")
        modified_files.append(addon_changelog)

    # 4. backend/pyproject.toml
    pyproject = root / "backend" / "pyproject.toml"
    if pyproject.is_file():
        text = pyproject.read_text(encoding="utf-8")
        text = re.sub(
            r'^version\s*=\s*["\']?[^"\'\s]+["\']?',
            f'version = "{new_version}"',
            text,
            flags=re.MULTILINE,
        )
        pyproject.write_text(text, encoding="utf-8")
        modified_files.append(pyproject)

    # 5. backend/src/jira_dashboard/__init__.py
    init_py = root / "backend" / "src" / "jira_dashboard" / "__init__.py"
    if init_py.is_file():
        text = init_py.read_text(encoding="utf-8")
        text = re.sub(
            r'^__version__\s*=\s*["\'][^"\']+["\']',
            f'__version__ = "{new_version}"',
            text,
            flags=re.MULTILINE,
        )
        init_py.write_text(text, encoding="utf-8")
        modified_files.append(init_py)

    # 6. backend/src/jira_dashboard/adapters/jira_cloud_client.py
    jira_client = (
        root
        / "backend"
        / "src"
        / "jira_dashboard"
        / "adapters"
        / "jira_cloud_client.py"
    )
    if jira_client.is_file():
        text = jira_client.read_text(encoding="utf-8")
        text = re.sub(
            r'("?User-Agent"?:\s*")HomeAssistant-JiraDashboard/[^"]+(")',
            rf"\g<1>HomeAssistant-JiraDashboard/{new_version}\g<2>",
            text,
        )
        jira_client.write_text(text, encoding="utf-8")
        modified_files.append(jira_client)

    # 7. backend/src/jira_dashboard/presentation/main.py
    main_py = root / "backend" / "src" / "jira_dashboard" / "presentation" / "main.py"
    if main_py.is_file():
        text = main_py.read_text(encoding="utf-8")
        text = re.sub(
            r'version="[^"]+",',
            f'version="{new_version}",',
            text,
        )
        main_py.write_text(text, encoding="utf-8")
        modified_files.append(main_py)

    # 8. backend/tests/test_packaging_and_addon.py
    pkg_test = root / "backend" / "tests" / "test_packaging_and_addon.py"
    if pkg_test.is_file():
        text = pkg_test.read_text(encoding="utf-8")
        text = text.replace(
            f'assert config["version"] == "{current_version}"',
            f'assert config["version"] == "{new_version}"',
        )
        text = text.replace(
            f'assert "{current_version}" in changelog_text',
            f'assert "{new_version}" in changelog_text',
        )
        pkg_test.write_text(text, encoding="utf-8")
        modified_files.append(pkg_test)

    # 9. backend/tests/test_placeholder.py
    ph_test = root / "backend" / "tests" / "test_placeholder.py"
    if ph_test.is_file():
        text = ph_test.read_text(encoding="utf-8")
        text = text.replace(
            f'self.assertEqual(jira_dashboard.__version__, "{current_version}")',
            f'self.assertEqual(jira_dashboard.__version__, "{new_version}")',
        )
        ph_test.write_text(text, encoding="utf-8")
        modified_files.append(ph_test)

    # 10. frontend/package.json
    pkg_json = root / "frontend" / "package.json"
    if pkg_json.is_file():
        text = pkg_json.read_text(encoding="utf-8")
        text = re.sub(
            r'"version":\s*"[^"]+"',
            f'"version": "{new_version}"',
            text,
            count=1,
        )
        pkg_json.write_text(text, encoding="utf-8")
        modified_files.append(pkg_json)

    # 11. frontend/src/utils/version.ts
    version_ts = root / "frontend" / "src" / "utils" / "version.ts"
    if version_ts.is_file():
        text = version_ts.read_text(encoding="utf-8")
        text = text.replace(f"'{current_version}'", f"'{new_version}'")
        version_ts.write_text(text, encoding="utf-8")
        modified_files.append(version_ts)

    # 12. frontend/src/utils/version.test.ts
    version_test_ts = root / "frontend" / "src" / "utils" / "version.test.ts"
    if version_test_ts.is_file():
        text = version_test_ts.read_text(encoding="utf-8")
        text = text.replace(f"'{current_version}'", f"'{new_version}'")
        version_test_ts.write_text(text, encoding="utf-8")
        modified_files.append(version_test_ts)

    # 13. frontend/src/components/SettingsView.test.tsx
    settings_test = root / "frontend" / "src" / "components" / "SettingsView.test.tsx"
    if settings_test.is_file():
        text = settings_test.read_text(encoding="utf-8")
        text = text.replace(
            f"version: '{current_version}'", f"version: '{new_version}'"
        )
        text = text.replace(
            f"expect(versionBadge?.textContent).toContain('{current_version}');",
            f"expect(versionBadge?.textContent).toContain('{new_version}');",
        )
        # Ensure backend version diff test doesn't match client version
        diff_ver = "1.0.0" if new_version != "1.0.0" else "2.0.0"
        text = re.sub(
            r"(displays backend version when different from client version.*?version:\s*')[^']+(\')",
            rf"\g<1>{diff_ver}\g<2>",
            text,
            flags=re.DOTALL,
        )
        text = re.sub(
            r"(expect\(backendBadge\?\.textContent\)\.toContain\(')[^']+(\'\))",
            rf"\g<1>{diff_ver}\g<2>",
            text,
        )
        settings_test.write_text(text, encoding="utf-8")
        modified_files.append(settings_test)

    return modified_files


def run_pre_release_ci(root: Path) -> None:
    """Run local CI verification script."""
    ci_script = root / "scripts" / "run_ci_locally.py"
    if not ci_script.is_file():
        print_warning(f"Local CI script not found at {ci_script}, skipping.")
        return

    print_step("Running Local Pre-Release CI Verification...")
    run_cmd([sys.executable, str(ci_script)], cwd=root)
    print_success("Pre-release CI checks passed with 100% success!")


def git_commit_and_tag(root: Path, version: str, notes: str) -> None:
    """Create Git commit and annotated tag for the release."""
    print_step(f"Creating Git commit and annotated tag 'v{version}'...")
    run_cmd(["git", "add", "-A"], cwd=root)
    commit_msg = f"chore(release): bump version to {version}"
    run_cmd(["git", "commit", "-m", commit_msg], cwd=root)

    first_line = (
        notes.strip().splitlines()[0].lstrip("- *").strip()
        if notes
        else f"Release v{version}"
    )
    tag_msg = f"Release v{version}: {first_line}"
    run_cmd(["git", "tag", "-a", f"v{version}", "-m", tag_msg], cwd=root)
    print_success(f"Created tag v{version}")


def git_push_and_release(root: Path, version: str, notes: str) -> None:
    """Push commit and tag to GitHub, then create GitHub Release."""
    print_step("Pushing Git commits and tags to GitHub...")
    res = run_cmd(["git", "branch", "--show-current"], cwd=root, capture_output=True)
    current_branch = res.stdout.strip() or "main"

    run_cmd(["git", "push", "origin", current_branch], cwd=root)
    run_cmd(["git", "push", "origin", f"v{version}"], cwd=root)
    print_success("Pushed to origin successfully!")

    if shutil.which("gh"):
        print_step("Publishing GitHub Release...")
        release_notes = f"## Release Notes (v{version})\n\n{notes.strip()}"
        run_cmd(
            [
                "gh",
                "release",
                "create",
                f"v{version}",
                "--title",
                f"v{version}",
                "--notes",
                release_notes,
            ],
            cwd=root,
        )
        print_success(f"Published GitHub Release v{version}!")
    else:
        print_warning(
            "GitHub CLI ('gh') is not installed; skipping GitHub Release publication."
        )


def deploy_to_gcp(root: Path, skip_ci: bool = True) -> None:
    """Trigger Google Cloud Platform Cloud Run deployment."""
    deploy_script = root / "scripts" / "deploy_gcp.py"
    if not deploy_script.is_file():
        print_warning("deploy_gcp.py not found; skipping GCP deployment.")
        return

    print_step("Deploying application to Google Cloud Run...")
    cmd = [sys.executable, str(deploy_script), "deploy"]
    if skip_ci:
        cmd.append("--skip-ci")
    run_cmd(cmd, cwd=root)
    print_success("GCP Cloud Run deployment complete!")


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Unified Release Automation CLI for Home Assistant Jira Dashboard & Cloud Run."
    )
    version_group = parser.add_mutually_exclusive_group()
    version_group.add_argument(
        "--bump",
        choices=["patch", "minor", "major"],
        default=None,
        help="Semver bump type (defaults to 'patch' if --version is not provided)",
    )
    version_group.add_argument(
        "--version",
        dest="explicit_version",
        help="Specify an explicit target version (e.g., 0.10.0)",
    )

    parser.add_argument(
        "--notes",
        help="Release notes markdown content (if omitted, extracted from Git history)",
    )
    parser.add_argument(
        "--notes-file",
        help="Path to file containing release notes markdown",
    )
    parser.add_argument(
        "--skip-ci",
        action="store_true",
        help="Skip local CI test runner",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview version calculation and release actions without modifying repository",
    )
    parser.add_argument(
        "--skip-push",
        action="store_true",
        help="Skip pushing Git commits/tags to remote and creating GitHub Release",
    )
    parser.add_argument(
        "--skip-gcp",
        action="store_true",
        help="Skip GCP Cloud Run deployment",
    )
    parser.add_argument(
        "--home-assistant-only",
        action="store_true",
        help="Only release for Home Assistant (alias for --skip-gcp)",
    )
    parser.add_argument(
        "--gcp-only",
        action="store_true",
        help="Only deploy to GCP Cloud Run without bumping version or releasing on GitHub",
    )
    return parser.parse_args()


def main() -> None:
    """Main release orchestration routine."""
    project_root = Path(__file__).resolve().parent.parent
    args = parse_args()
    start_time = time.time()

    # Case: GCP Only deployment
    if args.gcp_only:
        print_step("Executing GCP-Only Deployment...")
        deploy_to_gcp(project_root, skip_ci=args.skip_ci)
        print_success(
            f"GCP-Only Deployment finished in {time.time() - start_time:.1f}s"
        )
        return

    current_version = parse_current_version(project_root)

    # Determine target version
    if args.explicit_version:
        target_version = args.explicit_version.strip().lstrip("v")
    else:
        bump_type = VersionBumpType(args.bump) if args.bump else VersionBumpType.PATCH
        target_version = compute_next_version(current_version, bump_type)

    print(f"\n{BOLD}{CYAN}=== Home Assistant Jira Dashboard Release Automation ==={NC}")
    print(f"Current Version: {BOLD}{current_version}{NC}")
    print(f"Target Version:  {BOLD}{GREEN}{target_version}{NC}")

    # Determine release notes
    if args.notes_file:
        notes_path = Path(args.notes_file).resolve()
        notes = notes_path.read_text(encoding="utf-8")
    elif args.notes:
        notes = args.notes
    else:
        notes = generate_release_notes(project_root)

    print(f"\n{BOLD}Release Notes:{NC}\n{notes}\n")

    if args.dry_run:
        print_warning(
            "Dry-run mode enabled: No files will be modified, no Git tags or deployments will be created."
        )
        return

    # 1. Update version manifests
    print_step(
        f"Bumping version manifests from {current_version} to {target_version}..."
    )
    modified = update_all_version_files(
        project_root, current_version, target_version, notes
    )
    print_success(f"Updated {len(modified)} files across the repository:")
    for f in modified:
        rel_path = f.relative_to(project_root)
        print(f"  • {rel_path}")

    # 2. Run CI Verification
    if not args.skip_ci:
        run_pre_release_ci(project_root)

    # 3. Git commit & tag
    git_commit_and_tag(project_root, target_version, notes)

    # 4. Git push & GitHub Release
    if not args.skip_push:
        git_push_and_release(project_root, target_version, notes)

    # 5. GCP Cloud Run Deployment
    should_deploy_gcp = not args.skip_gcp and not args.home_assistant_only
    if should_deploy_gcp:
        deploy_to_gcp(project_root, skip_ci=True)

    elapsed = time.time() - start_time
    print_step("Release Complete! 🎉")
    print(
        f"\n{BOLD}{GREEN}Successfully released version v{target_version} in {elapsed:.1f}s{NC}\n"
    )


if __name__ == "__main__":
    main()
