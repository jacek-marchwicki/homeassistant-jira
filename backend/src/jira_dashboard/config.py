"""Configuration loader for Jira Dashboard.

Supports configuration via Home Assistant Add-on options (/data/options.json)
with fallback to environment variables and default development settings.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel, Field

DEFAULT_OPTIONS_PATH = Path("/data/options.json")


class JiraDashboardSettings(BaseModel):
    """Application settings for Jira Dashboard."""

    jira_url: str | None = Field(default=None, description="Jira instance base URL")
    jira_email: str | None = Field(default=None, description="Jira account email for basic auth")
    jira_api_token: str | None = Field(
        default=None, description="Jira Cloud API token for basic auth"
    )
    jira_personal_access_token: str | None = Field(
        default=None, description="Personal Access Token (PAT) for Jira Data Center / Server"
    )
    jira_board_id: str = Field(default="engineering-1", description="Default Jira Board ID to view")
    webhook_secret: str | None = Field(
        default=None, description="Shared secret for verifying Jira webhooks"
    )
    polling_interval_seconds: int = Field(
        default=60, description="Interval in seconds for fallback polling (0 disables polling)"
    )

    @property
    def has_jira_credentials(self) -> bool:
        """Return True if sufficient credentials exist to connect to a real Jira instance."""
        if not self.jira_url:
            return False
        if self.jira_email and self.jira_api_token:
            return True
        if self.jira_personal_access_token:
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
            "jira_personal_access_token": "JIRA_PAT",
            "jira_board_id": "JIRA_BOARD_ID",
            "webhook_secret": "JIRA_WEBHOOK_SECRET",
            "polling_interval_seconds": "POLLING_INTERVAL_SECONDS",
        }

        for field_name, env_var in env_mappings.items():
            val = os.environ.get(env_var)
            if val is not None and val != "":
                if field_name == "polling_interval_seconds":
                    try:
                        config_data[field_name] = int(val)
                    except ValueError:
                        pass
                else:
                    config_data[field_name] = val

        return cls(**config_data)
