"""Authentication and Authorization Provider for Jira Dashboard.

Supports:
- NONE: Local development without authentication
- HOMEASSISTANT: Home Assistant Ingress authentication (X-Remote-User-Name)
- GCP_OAUTH: Google OAuth 2.0 ID token verification and session cookies
  with strict email whitelisting.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from enum import Enum
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel
from starlette.requests import HTTPConnection

from jira_dashboard.config import JiraDashboardSettings

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "ha_jira_session"
DEFAULT_SESSION_MAX_AGE = 86400 * 30  # 30 days


class AuthMode(str, Enum):
    """Supported authentication modes."""

    AUTO = "auto"
    NONE = "none"
    HOMEASSISTANT = "homeassistant"
    GCP_OAUTH = "gcp_oauth"


class GoogleAuthUser(BaseModel):
    """Authenticated user profile representation."""

    email: str
    name: str = ""
    picture: str = ""


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = 4 - (len(data) % 4)
    if padding and padding < 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data.encode("utf-8"))


def create_session_token(
    user: GoogleAuthUser,
    secret: str,
    max_age_seconds: int = DEFAULT_SESSION_MAX_AGE,
) -> str:
    """Generate a tamper-proof HMAC-signed session token containing user claims."""
    now = int(time.time())
    payload = {
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "iat": now,
        "exp": now + max_age_seconds,
    }
    raw_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = _b64encode(raw_payload)

    signature = hmac.new(
        secret.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    sig_b64 = _b64encode(signature)

    return f"{payload_b64}.{sig_b64}"


def verify_session_token(token: str, secret: str) -> GoogleAuthUser | None:
    """Verify an HMAC-signed session token and return the authenticated user."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig_b64 = parts

        expected_sig = hmac.new(
            secret.encode("utf-8"),
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        provided_sig = _b64decode(sig_b64)

        if not hmac.compare_digest(expected_sig, provided_sig):
            return None

        raw_payload = _b64decode(payload_b64)
        claims = json.loads(raw_payload.decode("utf-8"))

        if not isinstance(claims, dict):
            return None

        exp = claims.get("exp")
        if exp is not None and int(exp) < int(time.time()):
            return None

        email = claims.get("email")
        if not email or not isinstance(email, str):
            return None

        return GoogleAuthUser(
            email=email.strip().lower(),
            name=str(claims.get("name", "")),
            picture=str(claims.get("picture", "")),
        )
    except Exception:
        return None


def verify_google_id_token(token: str, client_id: str | None = None) -> dict[str, Any]:
    """Verify a Google ID token using google-auth library."""
    from google.auth.transport import requests
    from google.oauth2 import id_token

    req = requests.Request()
    id_info = id_token.verify_oauth2_token(token, req, client_id)
    return id_info


def verify_google_bearer_token(token: str, client_id: str | None = None) -> dict[str, Any]:
    """Verify a Google bearer token (ID token JWT or OAuth 2.0 access token)."""
    # 1. Try verifying as an ID token (JWT with 3 segments)
    if token.count(".") == 2:
        try:
            return verify_google_id_token(token, client_id)
        except Exception as exc:
            logger.debug("Token not a valid Google ID token, trying userinfo endpoint: %s", exc)

    # 2. Try verifying as a Google OAuth 2.0 Access Token via Google userinfo endpoint
    import httpx

    try:
        resp = httpx.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict) and "email" in data:
                return data
    except Exception as exc:
        logger.debug("Failed to verify access token via Google userinfo: %s", exc)

    # 3. Fallback to Google OAuth tokeninfo endpoint
    try:
        resp = httpx.get(
            f"https://oauth2.googleapis.com/tokeninfo?access_token={token}",
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict) and "email" in data:
                return data
    except Exception as exc:
        logger.debug("Failed to verify access token via Google tokeninfo: %s", exc)

    raise ValueError("Invalid or expired Google bearer token")


class AuthProvider:
    """Central authentication and access-control provider."""

    def __init__(self, settings: JiraDashboardSettings) -> None:
        self.settings = settings
        self.resolved_mode = self._resolve_mode(settings)
        self.allowed_emails = settings.allowed_emails_set

    @staticmethod
    def _resolve_mode(settings: JiraDashboardSettings) -> AuthMode:
        explicit = settings.auth_mode.lower().strip()
        valid_modes = (AuthMode.NONE.value, AuthMode.HOMEASSISTANT.value, AuthMode.GCP_OAUTH.value)
        if explicit in valid_modes:
            return AuthMode(explicit)

        # Auto detection
        if os.environ.get("SUPERVISOR_TOKEN") or Path("/data/options.json").is_file():
            return AuthMode.HOMEASSISTANT

        if settings.google_client_id or settings.allowed_emails:
            return AuthMode.GCP_OAUTH

        return AuthMode.NONE

    def get_signing_secret(self) -> str:
        """Retrieve or derive the secret key for session signing."""
        if self.settings.session_secret_key:
            return self.settings.session_secret_key
        if self.settings.webhook_secret:
            return self.settings.webhook_secret
        if self.settings.google_client_secret:
            return self.settings.google_client_secret
        if self.resolved_mode == AuthMode.GCP_OAUTH:
            logger.warning(
                "Using fallback default signing secret in GCP_OAUTH mode! "
                "Set SESSION_SECRET_KEY, JIRA_WEBHOOK_SECRET, or GOOGLE_CLIENT_SECRET "
                "for production security."
            )
        # Fallback to persistent machine identifier or stable salt
        return "jira-dashboard-gcp-default-signing-key"

    def is_email_allowed(self, email: str) -> bool:
        """Check if an email address is authorized."""
        if not self.allowed_emails:
            # If no email whitelist is configured, allow all authenticated users
            return True
        return email.strip().lower() in self.allowed_emails

    def authenticate_request(
        self,
        request: HTTPConnection,
        authorization: str | None = None,
    ) -> GoogleAuthUser:
        """Authenticate an incoming HTTP request across configured providers."""
        if self.resolved_mode == AuthMode.NONE:
            return GoogleAuthUser(email="local@example.com", name="Local Development User")

        if self.resolved_mode == AuthMode.HOMEASSISTANT:
            ha_user = (
                request.headers.get("x-remote-user-name")
                or request.headers.get("x-remote-user-id")
                or "ha-user"
            )
            return GoogleAuthUser(email=f"{ha_user}@homeassistant.local", name=ha_user)

        # GCP_OAUTH Mode
        auth_header = authorization or request.headers.get("Authorization")
        if not auth_header and "token" in request.query_params:
            auth_header = f"Bearer {request.query_params['token']}"
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
            # 1. First check if it's our own HMAC session / OAuth bearer token
            session_user = verify_session_token(token, self.get_signing_secret())
            if session_user:
                if not self.is_email_allowed(session_user.email):
                    raise HTTPException(
                        status_code=403,
                        detail=f"Email '{session_user.email}' is not in allowed users list",
                    )
                return session_user

            # 2. Otherwise verify as an external Google bearer token
            try:
                info = verify_google_bearer_token(token, self.settings.google_client_id)
                email = str(info.get("email", "")).strip().lower()
                if not email or not self.is_email_allowed(email):
                    raise HTTPException(
                        status_code=403,
                        detail=f"Email '{email}' is not in allowed users list",
                    )
                return GoogleAuthUser(
                    email=email,
                    name=str(info.get("name", "")),
                    picture=str(info.get("picture", "")),
                )
            except HTTPException:
                raise
            except Exception as exc:
                logger.warning("Google bearer token verification failed: %s", exc)
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired Google bearer token",
                    headers={"WWW-Authenticate": "Bearer"},
                ) from exc

        # Check session cookie
        cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
        if cookie_token:
            user = verify_session_token(cookie_token, self.get_signing_secret())
            if user:
                if not self.is_email_allowed(user.email):
                    raise HTTPException(
                        status_code=403,
                        detail=f"Email '{user.email}' is not in allowed users list",
                    )
                return user

        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
