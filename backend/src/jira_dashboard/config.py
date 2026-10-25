"""Configuration loader for Jira Dashboard.

Supports configuration via Home Assistant Add-on options (/data/options.json)
with fallback to environment variables and default development settings.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

DEFAULT_OPTIONS_PATH = Path("/data/options.json")

DEFAULT_GEMINI_PROMPT_TEMPLATE = (
    "A simple, colorful, kid-friendly storybook illustration depicting the chore or activity: "
    "'{summary}'. Clean shapes, gentle lighting, playful and clear visual cues for children, "
    "minimal background distractions, no text or words in the image."
)


def ensure_local_data_dir(base_dir: Path | None = None) -> Path:
    """Ensure local ./data directory exists, automatically symlinking to main repo in git worktrees.

    When running inside a linked Git worktree, this automatically links ./data
    to the main repository's data directory so that SQLite schemas, cached Jira
    issues, and the AI background pictures cache are shared and reused seamlessly.
    """
    root = (base_dir or Path.cwd()).resolve()
    data_dir = root / "data"

    if data_dir.is_symlink() or data_dir.is_dir():
        return data_dir

    # Check if running inside a Git worktree (in a worktree, .git is a text file)
    git_file = root / ".git"
    if git_file.is_file():
        try:
            content = git_file.read_text(encoding="utf-8").strip()
            if content.startswith("gitdir:"):
                raw_git_dir = content.split(":", 1)[1].strip()
                git_dir = (root / raw_git_dir).resolve()

                # If commondir file exists, resolve common git dir from it
                common_dir_file = git_dir / "commondir"
                if common_dir_file.is_file():
                    common_rel = common_dir_file.read_text(encoding="utf-8").strip()
                    common_git = (git_dir / common_rel).resolve()
                else:
                    # Standard worktree layout: <main_repo>/.git/worktrees/<name>
                    common_git = git_dir.parent.parent.resolve()

                main_repo = common_git.parent.resolve()
                main_data = (main_repo / "data").resolve()
                main_data.mkdir(parents=True, exist_ok=True)
                (main_data / "background_cache").mkdir(parents=True, exist_ok=True)

                try:
                    rel_target = os.path.relpath(main_data, root)
                    data_dir.symlink_to(rel_target)
                except Exception:
                    data_dir.symlink_to(main_data)
                return data_dir
        except Exception:
            pass

    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "background_cache").mkdir(parents=True, exist_ok=True)
    return data_dir


class JiraDashboardSettings(BaseModel):
    """Application settings for Jira Dashboard."""

    jira_url: str | None = Field(default=None, description="Jira instance base URL")
    jira_email: str | None = Field(default=None, description="Jira account email for basic auth")
    jira_api_token: str | None = Field(
        default=None, description="Jira Cloud API token for basic auth"
    )
    jira_board_id: str = Field(default="engineering-1", description="Default Jira Board ID to view")
    webhook_secret: str | None = Field(
        default=None, description="Shared secret for verifying Jira webhooks"
    )
    polling_interval_seconds: int = Field(
        default=60, description="Interval in seconds for fallback polling (0 disables polling)"
    )
    sqlite_db_path: Path | str = Field(
        default="/data/jira_dashboard.sqlite3",
        description="Path to SQLite database for offline storage",
    )
    gemini_api_key: str | None = Field(
        default=None, description="Google GenAI / Gemini API key for AI background generation"
    )
    gemini_model: str = Field(
        default="gemini-3.1-flash-lite-image",
        description="Gemini model identifier for background image generation",
    )
    gemini_prompt_template: str = Field(
        default=DEFAULT_GEMINI_PROMPT_TEMPLATE,
        description="Prompt template for generating kid-friendly task background images",
    )
    gemini_daily_limit: int = Field(
        default=100, description="Maximum number of AI background images generated per day"
    )
    gemini_debounce_seconds: int = Field(
        default=300,
        description="Settle time in seconds after task modification before generating new image",
    )
    gemini_cache_retention_seconds: int = Field(
        default=2592000,
        description="Retention duration in seconds (30 days) before unrequested images are pruned",
    )
    auth_mode: str = Field(
        default="auto",
        description="Authentication mode: 'auto', 'none', 'homeassistant', or 'gcp_oauth'",
    )
    allowed_emails: str = Field(
        default="",
        description="Comma-separated list of allowed user email addresses",
    )
    google_client_id: str | None = Field(
        default=None,
        description="Google OAuth 2.0 Web Client ID",
    )
    google_client_secret: str | None = Field(
        default=None,
        description="Google OAuth 2.0 Web Client Secret",
    )
    session_secret_key: str | None = Field(
        default=None,
        description="Secret key for signing session tokens and cookies",
    )
    mcp_client_id: str = Field(
        default="gemini-mcp-client",
        description="Client ID for Gemini MCP OAuth authorization",
    )
    mcp_client_secret: str | None = Field(
        default=None,
        description="Client Secret for Gemini MCP OAuth authorization",
    )
    storage_backend: str | None = Field(
        default=None,
        description="Storage backend ('sqlite' or 'firestore')",
    )
    firestore_database_id: str = Field(
        default="(default)",
        description="Firestore database identifier",
    )
    image_storage_backend: str | None = Field(
        default=None,
        description="Blob image storage backend ('local' or 'gcs')",
    )
    image_storage_bucket: str | None = Field(
        default=None,
        description="GCS bucket name for image storage",
    )
    gcp_project_id: str | None = Field(
        default=None,
        description="Google Cloud Project ID",
    )

    @property
    def allowed_emails_set(self) -> set[str]:
        """Return the parsed set of allowed lowercase email addresses."""
        if not self.allowed_emails:
            return set()
        return {email.strip().lower() for email in self.allowed_emails.split(",") if email.strip()}

    @field_validator("gemini_api_key", mode="before")
    @classmethod
    def _sanitize_gemini_api_key(cls, v: Any) -> str | None:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return str(v).strip()

    @field_validator("gemini_model", mode="before")
    @classmethod
    def _sanitize_gemini_model(cls, v: Any) -> str:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "gemini-3.1-flash-lite-image"
        return str(v).strip()

    @field_validator("gemini_prompt_template", mode="before")
    @classmethod
    def _sanitize_gemini_prompt_template(cls, v: Any) -> str:
        if v is None or (isinstance(v, str) and not v.strip()):
            return DEFAULT_GEMINI_PROMPT_TEMPLATE
        return str(v).strip()

    @property
    def background_cache_dir(self) -> Path:
        """Directory where generated background images are cached on disk."""
        candidate = Path(self.sqlite_db_path).parent / "background_cache"
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            # Fallback to local data/background_cache in local development / testing
            dev_data = ensure_local_data_dir()
            dev_candidate = (dev_data / "background_cache").resolve()
            dev_candidate.mkdir(parents=True, exist_ok=True)
            return dev_candidate

    @property
    def has_jira_credentials(self) -> bool:
        """Return True if sufficient credentials exist to connect to a real Jira instance."""
        if not self.jira_url:
            return False
        if self.jira_email and self.jira_api_token:
            return True
        return False

    @classmethod
    def load(cls, options_path: Path | str | None = None) -> JiraDashboardSettings:
        """Load configuration from HA options file or environment variables."""
        config_data: dict[str, str | int] = {}

        # 1. Attempt to load from Home Assistant /data/options.json
        path = (
            Path(options_path)
            if options_path
            else Path(os.environ.get("HA_OPTIONS_PATH", DEFAULT_OPTIONS_PATH))
        )
        if path.is_file():
            try:
                with open(path, encoding="utf-8") as f:
                    file_options = json.load(f)
                if isinstance(file_options, dict):
                    config_data.update(file_options)
            except Exception:
                pass

        # 2. Overlay / Fallback to Environment Variables
        env_mappings: dict[str, str] = {
            "jira_url": "JIRA_URL",
            "jira_email": "JIRA_EMAIL",
            "jira_api_token": "JIRA_API_TOKEN",
            "jira_board_id": "JIRA_BOARD_ID",
            "webhook_secret": "JIRA_WEBHOOK_SECRET",
            "polling_interval_seconds": "POLLING_INTERVAL_SECONDS",
            "sqlite_db_path": "SQLITE_DB_PATH",
            "gemini_api_key": "GEMINI_API_KEY",
            "gemini_model": "GEMINI_MODEL",
            "gemini_prompt_template": "GEMINI_PROMPT_TEMPLATE",
            "gemini_daily_limit": "GEMINI_DAILY_LIMIT",
            "gemini_debounce_seconds": "GEMINI_DEBOUNCE_SECONDS",
            "gemini_cache_retention_seconds": "GEMINI_CACHE_RETENTION_SECONDS",
            "auth_mode": "AUTH_MODE",
            "allowed_emails": "ALLOWED_EMAILS",
            "google_client_id": "GOOGLE_CLIENT_ID",
            "google_client_secret": "GOOGLE_CLIENT_SECRET",
            "session_secret_key": "SESSION_SECRET_KEY",
            "mcp_client_id": "MCP_CLIENT_ID",
            "mcp_client_secret": "MCP_CLIENT_SECRET",
            "storage_backend": "STORAGE_BACKEND",
            "firestore_database_id": "FIRESTORE_DATABASE_ID",
            "image_storage_backend": "IMAGE_STORAGE_BACKEND",
            "image_storage_bucket": "IMAGE_STORAGE_BUCKET",
            "gcp_project_id": "GCP_PROJECT_ID",
        }

        int_fields = {
            "polling_interval_seconds",
            "gemini_daily_limit",
            "gemini_debounce_seconds",
            "gemini_cache_retention_seconds",
        }

        for field_name, env_var in env_mappings.items():
            val = os.environ.get(env_var)
            if val is not None and val != "":
                if field_name in int_fields:
                    try:
                        config_data[field_name] = int(val)
                    except ValueError:
                        pass
                else:
                    config_data[field_name] = val

        return cls(**config_data)
