"""Unit tests for Git worktree shared data directory resolution."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.config import JiraDashboardSettings, ensure_local_data_dir

# Import script module for test verification
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))
import setup_worktree_data  # noqa: E402


class TestWorktreeData(unittest.TestCase):
    """Test suite verifying worktree shared data directory mechanics."""

    def setUp(self) -> None:
        self.tmp_dir = tempfile.mkdtemp()
        self.tmp_path = Path(self.tmp_dir).resolve()
        self.orig_cwd = os.getcwd()

    def tearDown(self) -> None:
        os.chdir(self.orig_cwd)
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_ensure_local_data_dir_normal_repo(self) -> None:
        """In a standard repository root, creates a local data directory with background cache."""
        data_dir = ensure_local_data_dir(self.tmp_path)
        self.assertTrue(data_dir.is_dir())
        self.assertTrue((data_dir / "background_cache").is_dir())
        self.assertFalse(data_dir.is_symlink())

    def test_ensure_local_data_dir_existing_symlink(self) -> None:
        """If data is already a symlink, returns the symlink path directly without changes."""
        target_data = self.tmp_path / "shared_data"
        target_data.mkdir()
        data_link = self.tmp_path / "repo" / "data"
        data_link.parent.mkdir()
        data_link.symlink_to(target_data)

        resolved = ensure_local_data_dir(self.tmp_path / "repo")
        self.assertEqual(resolved, data_link)
        self.assertEqual(resolved.resolve(), target_data.resolve())

    def test_ensure_local_data_dir_in_worktree(self) -> None:
        """In a Git worktree, automatically creates a symlink to the main repo data directory."""
        main_repo = (self.tmp_path / "main_repo").resolve()
        main_repo.mkdir()
        (main_repo / ".git").mkdir()
        main_data = main_repo / "data"
        (main_data / "background_cache").mkdir(parents=True)
        (main_data / "jira_dashboard.sqlite3").write_text("mock-sqlite-db", encoding="utf-8")
        (main_data / "background_cache" / "cached.webp").write_bytes(b"mock-webp-data")

        git_worktree_dir = (main_repo / ".git" / "worktrees" / "test-feature").resolve()
        git_worktree_dir.mkdir(parents=True)
        (git_worktree_dir / "commondir").write_text("../..\n", encoding="utf-8")

        worktree_dir = (main_repo / ".worktrees" / "test-feature").resolve()
        worktree_dir.mkdir(parents=True)
        (worktree_dir / ".git").write_text(f"gitdir: {git_worktree_dir}\n", encoding="utf-8")

        result = ensure_local_data_dir(worktree_dir)
        self.assertEqual(result, worktree_dir / "data")
        self.assertTrue((worktree_dir / "data").is_symlink())
        self.assertEqual((worktree_dir / "data").resolve(), main_data)

        # Verify both database and background cache are immediately accessible
        self.assertEqual(
            (worktree_dir / "data" / "jira_dashboard.sqlite3").read_text(encoding="utf-8"),
            "mock-sqlite-db",
        )
        self.assertEqual(
            (worktree_dir / "data" / "background_cache" / "cached.webp").read_bytes(),
            b"mock-webp-data",
        )

    def test_storage_and_settings_in_worktree(self) -> None:
        """Verify SQLiteStorage and JiraDashboardSettings background_cache_dir
        resolve to worktree shared data.
        """
        main_repo = (self.tmp_path / "main_repo").resolve()
        main_repo.mkdir()
        (main_repo / ".git").mkdir()
        main_data = main_repo / "data"
        (main_data / "background_cache").mkdir(parents=True)

        git_worktree_dir = (main_repo / ".git" / "worktrees" / "feat-x").resolve()
        git_worktree_dir.mkdir(parents=True)
        (git_worktree_dir / "commondir").write_text("../..\n", encoding="utf-8")

        worktree_dir = (main_repo / ".worktrees" / "feat-x").resolve()
        worktree_dir.mkdir(parents=True)
        (worktree_dir / ".git").write_text(f"gitdir: {git_worktree_dir}\n", encoding="utf-8")

        os.chdir(worktree_dir)

        # When sqlite_db_path is relative ./data/...
        storage = SQLiteStorage("./data/jira_dashboard.sqlite3")
        self.assertEqual(
            Path(storage.db_path).resolve(), (main_data / "jira_dashboard.sqlite3").resolve()
        )
        self.assertTrue((worktree_dir / "data").is_symlink())

        # When background_cache_dir is accessed with non-existent /data
        settings = JiraDashboardSettings(
            sqlite_db_path="/nonexistent_root_dir/jira_dashboard.sqlite3"
        )
        cache_dir = settings.background_cache_dir
        self.assertEqual(cache_dir.resolve(), (main_data / "background_cache").resolve())

    def test_link_worktree_data_preserves_existing_cache(self) -> None:
        """Verify setup_worktree_data.link_worktree_data preserves any newly
        generated webp images.
        """
        main_repo = (self.tmp_path / "main_repo").resolve()
        main_data = main_repo / "data"
        (main_data / "background_cache").mkdir(parents=True)
        (main_data / "background_cache" / "main_img.webp").write_bytes(b"main")

        worktree_dir = (self.tmp_path / "worktree").resolve()
        worktree_data = worktree_dir / "data"
        (worktree_data / "background_cache").mkdir(parents=True)
        (worktree_data / "background_cache" / "worktree_img.webp").write_bytes(b"worktree")

        success = setup_worktree_data.link_worktree_data(worktree_dir, main_data)
        self.assertTrue(success)
        self.assertTrue(worktree_data.is_symlink())
        self.assertEqual(worktree_data.resolve(), main_data)

        # Both images should now exist in the shared main cache
        self.assertTrue((main_data / "background_cache" / "main_img.webp").exists())
        self.assertTrue((main_data / "background_cache" / "worktree_img.webp").exists())
