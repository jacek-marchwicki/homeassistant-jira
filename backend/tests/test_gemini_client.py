"""Unit tests for Gemini image client adapter and factory."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from jira_dashboard.adapters.gemini_client import (
    GoogleGenAIImageClient,
    MockGeminiImageClient,
    compute_background_content_hash,
    create_gemini_client,
)
from jira_dashboard.config import JiraDashboardSettings


class TestGeminiImageClient(unittest.IsolatedAsyncioTestCase):
    """Test suite verifying Gemini image generation clients."""

    async def test_mock_client_generates_valid_bytes(self) -> None:
        client = MockGeminiImageClient()
        self.assertEqual(client.call_count, 0)
        self.assertEqual(len(client.prompts_received), 0)

        image_bytes = await client.generate_image("A cute dog cleaning a room")
        self.assertIsNotNone(image_bytes)
        self.assertGreater(len(image_bytes), 0)
        self.assertEqual(client.call_count, 1)
        self.assertIn("A cute dog cleaning a room", client.prompts_received)

    async def test_mock_client_configurable_failure(self) -> None:
        client = MockGeminiImageClient(should_fail=True)
        image_bytes = await client.generate_image("A cute cat")
        self.assertIsNone(image_bytes)
        self.assertEqual(client.call_count, 1)

    def test_compute_content_hash_deterministic(self) -> None:
        hash1 = compute_background_content_hash(
            model="gemini-3.1-flash-lite-image",
            prompt_template="Chore: {summary}",
            summary="Clean bedroom",
            description="Tidy the bed and pick up toys",
        )
        hash2 = compute_background_content_hash(
            model="gemini-3.1-flash-lite-image",
            prompt_template="Chore: {summary}",
            summary="  clean bedroom  ",
            description="Tidy the bed and pick up toys  ",
        )
        # Same normalized values produce identical hash
        self.assertEqual(hash1, hash2)

        # Different summary produces different hash
        hash3 = compute_background_content_hash(
            model="gemini-3.1-flash-lite-image",
            prompt_template="Chore: {summary}",
            summary="Do dishes",
            description="Tidy the bed and pick up toys",
        )
        self.assertNotEqual(hash1, hash3)

    def test_factory_returns_mock_when_fake_or_testing(self) -> None:
        settings = JiraDashboardSettings(gemini_api_key="mock")
        client = create_gemini_client(settings)
        self.assertIsInstance(client, MockGeminiImageClient)

    def test_factory_returns_none_when_no_api_key(self) -> None:
        with patch.dict("os.environ", {"JIRA_USE_FAKE": "0", "TESTING": "0"}, clear=False):
            settings = JiraDashboardSettings(gemini_api_key=None)
            client = create_gemini_client(settings)
            self.assertIsNone(client)

    def test_factory_returns_real_client_when_key_present(self) -> None:
        with patch.dict("os.environ", {"JIRA_USE_FAKE": "0", "TESTING": "0"}, clear=False):
            settings = JiraDashboardSettings(gemini_api_key="test-api-key-1234")
            with patch("jira_dashboard.adapters.gemini_client.genai"):
                client = create_gemini_client(settings)
                self.assertIsInstance(client, GoogleGenAIImageClient)

    async def test_google_client_gemini_model_uses_generate_content(self) -> None:
        with patch("jira_dashboard.adapters.gemini_client.genai") as mock_genai_mod:
            mock_client_instance = mock_genai_mod.Client.return_value
            mock_part = unittest.mock.MagicMock()
            mock_part.inline_data.data = b"gemini-image-bytes"
            mock_response = unittest.mock.MagicMock()
            mock_response.parts = [mock_part]
            mock_client_instance.models.generate_content.return_value = mock_response

            client = GoogleGenAIImageClient(api_key="fake-key", model="gemini-3.1-flash-lite-image")
            result = await client.generate_image("A clean kitchen", aspect_ratio="16:9")

            self.assertEqual(result, b"gemini-image-bytes")
            mock_client_instance.models.generate_content.assert_called_once()
            call_kwargs = mock_client_instance.models.generate_content.call_args.kwargs
            self.assertEqual(call_kwargs["model"], "gemini-3.1-flash-lite-image")
            self.assertEqual(call_kwargs["contents"], "A clean kitchen")

    async def test_google_client_imagen_model_uses_generate_images(self) -> None:
        with patch("jira_dashboard.adapters.gemini_client.genai") as mock_genai_mod:
            mock_client_instance = mock_genai_mod.Client.return_value
            mock_generated_image = unittest.mock.MagicMock()
            mock_generated_image.image.image_bytes = b"imagen-image-bytes"
            mock_response = unittest.mock.MagicMock()
            mock_response.generated_images = [mock_generated_image]
            mock_client_instance.models.generate_images.return_value = mock_response

            client = GoogleGenAIImageClient(api_key="fake-key", model="imagen-3.0-generate-002")
            result = await client.generate_image("A clean kitchen", aspect_ratio="16:9")

            self.assertEqual(result, b"imagen-image-bytes")
            mock_client_instance.models.generate_images.assert_called_once()
            call_kwargs = mock_client_instance.models.generate_images.call_args.kwargs
            self.assertEqual(call_kwargs["model"], "imagen-3.0-generate-002")

    async def test_google_client_handles_generation_exception_gracefully(self) -> None:
        with patch("jira_dashboard.adapters.gemini_client.genai") as mock_genai_mod:
            mock_client_instance = mock_genai_mod.Client.return_value
            mock_client_instance.models.generate_content.side_effect = RuntimeError(
                "API connection failed"
            )

            client = GoogleGenAIImageClient(api_key="fake-key", model="gemini-3.1-flash-lite-image")
            result = await client.generate_image("A clean kitchen")

            self.assertIsNone(result)
