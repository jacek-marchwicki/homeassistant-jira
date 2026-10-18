#!/usr/bin/env python3
"""Worktree data setup script for Home Assistant Jira Dashboard.

Ensures that new and existing Git worktrees reuse the root data directory
(sharing the SQLite database, schema migrations, and cached background pictures).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def configure_git_hooks(repo_root: Path) -> bool:
    """Configure Git to use .githooks and ensure post-checkout hook is installed."""
    hooks_dir = repo_root / ".githooks"
    hook_file = hooks_dir / "post-checkout"
    if hook_file.is_file():
        hook_file.chmod(0o755)

    try:
        subprocess.run(
            ["git", "config", "core.hooksPath", ".githooks"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
    except subprocess.SubprocessError as exc:
        print(f"Warning: could not set git config core.hooksPath: {exc}")
        return False

    # Also sync into .git/hooks for direct compatibility
    git_hooks_dir = repo_root / ".git" / "hooks"
    if git_hooks_dir.is_dir() and hook_file.is_file():
        target_hook = git_hooks_dir / "post-checkout"
        try:
            shutil.copy2(hook_file, target_hook)
            target_hook.chmod(0o755)
        except OSError:
            pass

    # Ensure .git/info/exclude ignores data symlink on any branch
    exclude_file = repo_root / ".git" / "info" / "exclude"
    if exclude_file.is_file():
        try:
            content = exclude_file.read_text(encoding="utf-8")
            additions = [
                line for line in ("data", "data/") if line not in content.splitlines()
            ]
            if additions:
                exclude_file.write_text(
                    content.rstrip() + "\n" + "\n".join(additions) + "\n",
                    encoding="utf-8",
                )
        except OSError:
            pass

    return True


def link_worktree_data(worktree_dir: Path, main_data_dir: Path) -> bool:
    """Link the data directory in a worktree to the main data directory."""
    worktree_resolved = worktree_dir.resolve()
    main_data_resolved = main_data_dir.resolve()
    data_link = worktree_resolved / "data"

    main_data_resolved.mkdir(parents=True, exist_ok=True)
    (main_data_resolved / "background_cache").mkdir(parents=True, exist_ok=True)

    try:
        rel_target = os.path.relpath(main_data_resolved, worktree_resolved)
    except ValueError:
        rel_target = str(main_data_resolved)

    if data_link.is_symlink():
        current_target = os.readlink(data_link)
        if current_target in (rel_target, str(main_data_resolved)):
            return True
        data_link.unlink()
    elif data_link.is_dir():
        # Preserve any cached webp files before replacing directory
        local_cache = data_link / "background_cache"
        if local_cache.is_dir():
            for webp_file in local_cache.glob("*.webp"):
                dest = main_data_resolved / "background_cache" / webp_file.name
                if not dest.exists():
                    shutil.copy2(webp_file, dest)
        shutil.rmtree(data_link)
    elif data_link.exists():
        data_link.unlink()

    data_link.symlink_to(rel_target)
    return True


def find_main_repo_and_data(cwd: Path | None = None) -> tuple[Path, Path]:
    """Find the root repository directory and root data directory."""
    current = (cwd or Path.cwd()).resolve()

    # Check if we are inside a Git worktree
    git_file = current / ".git"
    if git_file.is_file():
        try:
            content = git_file.read_text(encoding="utf-8").strip()
            if content.startswith("gitdir:"):
                raw_git_dir = content.split(":", 1)[1].strip()
                git_dir = (current / raw_git_dir).resolve()
                commondir_file = git_dir / "commondir"
                if commondir_file.is_file():
                    common_rel = commondir_file.read_text(encoding="utf-8").strip()
                    common_git = (git_dir / common_rel).resolve()
                else:
                    common_git = git_dir.parent.parent.resolve()
                main_repo = common_git.parent.resolve()
                return main_repo, main_repo / "data"
        except (OSError, ValueError, IndexError):
            pass

    # Otherwise assume current directory or search upward for .git directory
    cursor = current
    while cursor != cursor.parent:
        if (cursor / ".git").is_dir():
            return cursor, cursor / "data"
        cursor = cursor.parent

    return current, current / "data"


def check_worktrees(repo_root: Path) -> bool:
    """Verify all worktrees are properly linked to the shared data directory."""
    main_data = (repo_root / "data").resolve()
    worktrees_root = repo_root / ".worktrees"
    all_ok = True

    if not worktrees_root.is_dir():
        print("No .worktrees directory found.")
        return True

    for entry in sorted(worktrees_root.iterdir()):
        if entry.is_dir() and (entry / ".git").is_file():
            data_link = entry / "data"
            if not data_link.is_symlink():
                print(f"FAIL: Worktree '{entry.name}' data is not a symlink.")
                all_ok = False
            else:
                resolved = data_link.resolve()
                if resolved != main_data:
                    print(
                        f"FAIL: Worktree '{entry.name}' data points to '{resolved}', expected '{main_data}'."
                    )
                    all_ok = False
                else:
                    print(
                        f"OK: Worktree '{entry.name}' properly shares data directory."
                    )

    return all_ok


def setup_all(repo_root: Path) -> int:
    """Configure Git hooks and link all existing worktrees to shared data directory."""
    main_repo, main_data = find_main_repo_and_data(repo_root)
    main_data.mkdir(parents=True, exist_ok=True)
    (main_data / "background_cache").mkdir(parents=True, exist_ok=True)

    configure_git_hooks(main_repo)

    # If running directly inside a worktree, ensure its own data is linked
    if repo_root != main_repo:
        link_worktree_data(repo_root, main_data)
        print(f"Linked data directory for current worktree: {repo_root.name}")

    worktrees_root = main_repo / ".worktrees"
    if worktrees_root.is_dir():
        for entry in sorted(worktrees_root.iterdir()):
            if entry.is_dir() and (entry / ".git").is_file():
                link_worktree_data(entry, main_data)
                print(f"Linked data directory for worktree: {entry.name}")

    print("All worktrees configured to reuse root data directory.")
    return 0


def main() -> int:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Set up shared data directory and Git hooks for worktrees."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if all worktrees properly share the data directory without modifying anything.",
    )
    args = parser.parse_args()

    repo_root, _ = find_main_repo_and_data(Path.cwd())
    if args.check:
        ok = check_worktrees(repo_root)
        return 0 if ok else 1

    return setup_all(repo_root)


if __name__ == "__main__":
    sys.exit(main())
