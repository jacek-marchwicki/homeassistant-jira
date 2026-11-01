"""Google GenAI (Gemini) image generation client adapter.

Provides asynchronous kid-friendly illustration generation for chores and tasks,
with rate limiting / HTTP 429 quota backoff and mock client support for zero-cost testing.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Any

from jira_dashboard.config import JiraDashboardSettings

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None  # type: ignore[assignment]
    types = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# Lightweight 1x1 transparent PNG bytes for mock testing
MOCK_IMAGE_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x03\x00\x08\xfc"
    b"\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82"
)


def compute_background_content_hash(
    model: str,
    prompt_template: str,
    summary: str,
    description: str | None = None,
) -> str:
    """Compute deterministic SHA-256 content hash for deduplication.

    Content hash: SHA-256 over
    (model + prompt_template + normalized_summary + normalized_description).
    """
    normalized_summary = summary.strip().lower()
    normalized_description = (description or "").strip().lower()
    payload = f"{model}:{prompt_template}:{normalized_summary}:{normalized_description}".encode()
    return hashlib.sha256(payload).hexdigest()


def is_rate_limit_error(exc: Exception) -> bool:
    """Determine whether an exception represents an HTTP 429 / quota exhaustion / rate limit.

    Detects Google GenAI ClientError/APIError with code 429, gRPC ResourceExhausted,
    HTTP status codes, or typical quota exhaustion error messages.
    """
    # 1. Direct code or status_code attributes on exception
    code = getattr(exc, "code", None)
    if code in (429, "429"):
        return True
    status_code = getattr(exc, "status_code", None)
    if status_code in (429, "429"):
        return True

    # 2. Status code on underlying response object (e.g. httpx / requests / google SDK responses)
    resp = getattr(exc, "response", None)
    if resp is not None:
        resp_status = getattr(resp, "status_code", None)
        if resp_status in (429, "429"):
            return True

    # 3. Known exception class names
    cls_name = exc.__class__.__name__
    if cls_name in (
        "ResourceExhausted",
        "RateLimitExceeded",
        "QuotaExceeded",
        "TooManyRequests",
    ):
        return True

    # 4. Error string message heuristics
    err_str = str(exc).lower()
    indicators = (
        "429",
        "resource_exhausted",
        "resource has been exhausted",
        "quota exceeded",
        "rate limit",
        "rate_limit",
        "too many requests",
    )
    if any(indicator in err_str for indicator in indicators):
        return True

    return False


def extract_retry_after(exc: Exception) -> float | None:
    """Extract recommended retry delay (in seconds) from an exception if available."""
    # 1. Inspect HTTP response headers
    resp = getattr(exc, "response", None)
    if resp is not None:
        headers = getattr(resp, "headers", None)
        if headers and hasattr(headers, "get"):
            header_val = headers.get("retry-after") or headers.get("Retry-After")
            if header_val:
                try:
                    return float(header_val)
                except (ValueError, TypeError):
                    pass

    # 2. Inspect structured error details (e.g. Google RPC RetryInfo)
    resp_json = getattr(exc, "response_json", None)
    if isinstance(resp_json, dict):
        details = resp_json.get("error", {}).get("details", [])
        if isinstance(details, list):
            for detail in details:
                if isinstance(detail, dict) and "retryDelay" in detail:
                    delay_str = str(detail["retryDelay"]).rstrip("s")
                    try:
                        return float(delay_str)
                    except (ValueError, TypeError):
                        pass

    # 3. Fallback regex searching in error message string
    err_str = str(exc)
    match = re.search(
        r"(?:retry[-_ ]?delay|retry[-_ ]?after)[\"\'=:\s]+([0-9]+(?:\.[0-9]+)?)\s*s?",
        err_str,
        re.IGNORECASE,
    )
    if match:
        try:
            return float(match.group(1))
        except (ValueError, TypeError):
            pass

    return None


class GeminiImageClient(ABC):
    """Abstract interface for generating AI chore illustrations."""

    def __init__(self, default_cooldown_seconds: float = 60.0) -> None:
        self.default_cooldown_seconds = default_cooldown_seconds
        self._rate_limit_until: float = 0.0

    @property
    def is_rate_limited(self) -> bool:
        """Return True if client is in an active rate-limit cooldown window."""
        return time.monotonic() < self._rate_limit_until

    @property
    def rate_limit_cooldown_remaining(self) -> float:
        """Return remaining seconds in active rate-limit cooldown window, or 0.0."""
        return max(0.0, self._rate_limit_until - time.monotonic())

    def trigger_rate_limit(self, cooldown_seconds: float | None = None) -> None:
        """Activate rate limit cooldown window for given seconds or default."""
        cooldown = (
            cooldown_seconds
            if cooldown_seconds is not None and cooldown_seconds > 0
            else self.default_cooldown_seconds
        )
        self._rate_limit_until = time.monotonic() + cooldown

    def reset_rate_limit(self) -> None:
        """Clear active rate limit cooldown."""
        self._rate_limit_until = 0.0

    @abstractmethod
    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        """Generate image bytes from prompt, returning binary image data or None on error."""
        pass


class MockGeminiImageClient(GeminiImageClient):
    """In-memory test double and simulation client for Gemini image generation.

    Incurs $0 cost, executes instantaneously, and tracks call counts for verification.
    Supports simulation of HTTP 429 rate limits and cooldown backoff.
    """

    def __init__(
        self,
        image_bytes: bytes = MOCK_IMAGE_BYTES,
        should_fail: bool = False,
        simulate_rate_limit: bool = False,
        simulate_429: bool = False,
        cooldown_seconds: float = 60.0,
        default_cooldown_seconds: float = 60.0,
    ) -> None:
        eff_cooldown = cooldown_seconds if cooldown_seconds != 60.0 else default_cooldown_seconds
        super().__init__(default_cooldown_seconds=eff_cooldown)
        self.image_bytes = image_bytes
        self.should_fail = should_fail
        self.simulate_rate_limit = simulate_rate_limit or simulate_429
        self.simulate_429 = self.simulate_rate_limit
        self.call_count: int = 0
        self.prompts_received: list[str] = []

    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        self.call_count += 1
        self.prompts_received.append(prompt)

        # Fast exit if in active cooldown window
        if self.is_rate_limited:
            logger.warning(
                "Mock Gemini API rate limit active (%.1fs cooldown); skipping generation",
                self.rate_limit_cooldown_remaining,
            )
            return None

        # Simulate encountering 429 / rate limit
        if self.simulate_rate_limit or self.simulate_429:
            self.trigger_rate_limit()
            logger.warning(
                "Mock Gemini API simulated HTTP 429 encountered; activating %.1fs cooldown",
                self.default_cooldown_seconds,
            )
            return None

        if self.should_fail:
            return None
        return self.image_bytes


class GoogleGenAIImageClient(GeminiImageClient):
    """Real Google GenAI adapter using the official modern google-genai SDK."""

    def __init__(
        self,
        api_key: str,
        model: str,
        default_cooldown_seconds: float = 60.0,
    ) -> None:
        super().__init__(default_cooldown_seconds=default_cooldown_seconds)
        if genai is None:
            raise RuntimeError("google-genai library is not installed.")

        self._api_key = api_key
        self._model = model
        self._client: Any = genai.Client(api_key=api_key)

    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        """Call Gemini image generation model asynchronously."""
        if self.is_rate_limited:
            logger.warning(
                "Gemini API rate-limited (%.1fs cooldown remaining); skipping generation",
                self.rate_limit_cooldown_remaining,
            )
            return None

        if types is None:
            return None

        def _sync_call() -> bytes | None:
            try:
                if self._model.startswith("gemini-"):
                    image_cfg = (
                        types.ImageConfig(aspect_ratio=aspect_ratio)
                        if hasattr(types, "ImageConfig")
                        else None
                    )
                    config = types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                        image_config=image_cfg,
                    )
                    response = self._client.models.generate_content(
                        model=self._model,
                        contents=prompt,
                        config=config,
                    )
                    if hasattr(response, "parts") and response.parts:
                        for part in response.parts:
                            if part.inline_data and part.inline_data.data:
                                return bytes(part.inline_data.data)
                    if hasattr(response, "candidates") and response.candidates:
                        for cand in response.candidates:
                            if cand.content and cand.content.parts:
                                for part in cand.content.parts:
                                    if part.inline_data and part.inline_data.data:
                                        return bytes(part.inline_data.data)
                    return None

                response = self._client.models.generate_images(
                    model=self._model,
                    prompt=prompt,
                    config=types.GenerateImagesConfig(
                        number_of_images=1,
                        output_mime_type="image/webp",
                        aspect_ratio=aspect_ratio,
                    ),
                )
                if response and response.generated_images:
                    img = response.generated_images[0]
                    return bytes(img.image.image_bytes)
                return None
            except Exception as exc:
                if is_rate_limit_error(exc):
                    retry_after = extract_retry_after(exc)
                    cooldown = (
                        retry_after
                        if (retry_after is not None and retry_after > 0)
                        else self.default_cooldown_seconds
                    )
                    self.trigger_rate_limit(cooldown)
                    logger.warning(
                        "Gemini rate limit encountered (429 / Quota). Cooldown %.1fs: %s",
                        cooldown,
                        exc,
                    )
                    return None
                logger.warning("Gemini image generation failed: %s", exc)
                return None

        return await asyncio.to_thread(_sync_call)


def create_gemini_client(settings: JiraDashboardSettings | None = None) -> GeminiImageClient | None:
    """Create a configured GeminiImageClient instance based on settings and environment."""
    if settings is None:
        settings = JiraDashboardSettings.load()

    cooldown_seconds = float(getattr(settings, "gemini_cooldown_seconds", 60.0))

    # In fake/test mode or if explicitly mock
    if (
        os.environ.get("JIRA_USE_FAKE") == "1"
        or os.environ.get("TESTING") == "1"
        or settings.gemini_api_key == "mock"
    ):
        return MockGeminiImageClient(default_cooldown_seconds=cooldown_seconds)

    if not settings.gemini_api_key:
        return None

    try:
        return GoogleGenAIImageClient(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            default_cooldown_seconds=cooldown_seconds,
        )
    except Exception as exc:
        logger.error("Failed to initialize GoogleGenAIImageClient: %s", exc)
        return None
