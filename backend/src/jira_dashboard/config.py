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
    sqlite_db_path: str = Field(
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
            dev_candidate = Path("./data/background_cache").resolve()
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
