"""Google GenAI (Gemini) image generation client adapter.

Provides asynchronous kid-friendly illustration generation for chores and tasks,
with mock client support for zero-cost testing and simulation.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
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


class GeminiImageClient(ABC):
    """Abstract interface for generating AI chore illustrations."""

    @abstractmethod
    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        """Generate image bytes from prompt, returning binary image data or None on error."""
        pass


class MockGeminiImageClient(GeminiImageClient):
    """In-memory test double and simulation client for Gemini image generation.

    Incurs $0 cost, executes instantaneously, and tracks call counts for verification.
    """

    def __init__(
        self,
        image_bytes: bytes = MOCK_IMAGE_BYTES,
        should_fail: bool = False,
    ) -> None:
        self.image_bytes = image_bytes
        self.should_fail = should_fail
        self.call_count: int = 0
        self.prompts_received: list[str] = []

    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        self.call_count += 1
        self.prompts_received.append(prompt)
        if self.should_fail:
            return None
        return self.image_bytes


class GoogleGenAIImageClient(GeminiImageClient):
    """Real Google GenAI adapter using the official modern google-genai SDK."""

    def __init__(self, api_key: str, model: str) -> None:
        if genai is None:
            raise RuntimeError("google-genai library is not installed.")

        self._api_key = api_key
        self._model = model
        self._client: Any = genai.Client(api_key=api_key)

    async def generate_image(self, prompt: str, aspect_ratio: str = "16:9") -> bytes | None:
        """Call Gemini image generation model asynchronously."""
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
                logger.warning("Gemini image generation failed: %s", exc)
                return None

        return await asyncio.to_thread(_sync_call)


def create_gemini_client(settings: JiraDashboardSettings | None = None) -> GeminiImageClient | None:
    """Create a configured GeminiImageClient instance based on settings and environment."""
    if settings is None:
        settings = JiraDashboardSettings.load()

    # In fake/test mode or if explicitly mock
    if (
        os.environ.get("JIRA_USE_FAKE") == "1"
        or os.environ.get("TESTING") == "1"
        or settings.gemini_api_key == "mock"
    ):
        return MockGeminiImageClient()

    if not settings.gemini_api_key:
        return None

    try:
        return GoogleGenAIImageClient(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        )
    except Exception as exc:
        logger.error("Failed to initialize GoogleGenAIImageClient: %s", exc)
        return None
