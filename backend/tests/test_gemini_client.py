"""Unit tests for Gemini image client adapter and factory."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from jira_dashboard.adapters.gemini_client import (
    GoogleGenAIImageClient,
    MockGeminiImageClient,
    compute_background_content_hash,
    create_gemini_client,
    extract_retry_after,
    is_rate_limit_error,
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

    def test_is_rate_limit_error(self) -> None:
        """Verify rate limit detection across exception types, status codes, and messages."""

        # 1. Code attribute
        class MockCodeErr(Exception):
            def __init__(self, code: int | str) -> None:
                self.code = code

        self.assertTrue(is_rate_limit_error(MockCodeErr(429)))
        self.assertTrue(is_rate_limit_error(MockCodeErr("429")))
        self.assertFalse(is_rate_limit_error(MockCodeErr(400)))

        # 2. Status code attribute
        class MockStatusErr(Exception):
            def __init__(self, status_code: int) -> None:
                self.status_code = status_code

        self.assertTrue(is_rate_limit_error(MockStatusErr(429)))
        self.assertFalse(is_rate_limit_error(MockStatusErr(500)))

        # 3. Class name
        class ResourceExhausted(Exception):
            pass

        class QuotaExceeded(Exception):
            pass

        self.assertTrue(is_rate_limit_error(ResourceExhausted("quota limit")))
        self.assertTrue(is_rate_limit_error(QuotaExceeded()))

        # 4. Message heuristics
        self.assertTrue(is_rate_limit_error(RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded")))
        self.assertTrue(is_rate_limit_error(Exception("Rate limit reached for model")))
        self.assertTrue(is_rate_limit_error(Exception("Too Many Requests: slow down")))
        self.assertFalse(is_rate_limit_error(RuntimeError("Connection reset by peer")))

    def test_extract_retry_after(self) -> None:
        """Verify extraction of retry delays from headers, JSON details, and error strings."""

        # 1. HTTP header
        class MockRespErr(Exception):
            def __init__(self, retry_after: str) -> None:
                self.response = unittest.mock.MagicMock()
                self.response.headers = {"Retry-After": retry_after}

        self.assertEqual(extract_retry_after(MockRespErr("45")), 45.0)

        # 2. JSON details with retryDelay
        class MockJsonErr(Exception):
            def __init__(self) -> None:
                self.response_json = {
                    "error": {
                        "code": 429,
                        "details": [{"@type": "RetryInfo", "retryDelay": "35.5s"}],
                    }
                }

        self.assertEqual(extract_retry_after(MockJsonErr()), 35.5)

        # 3. String regex
        self.assertEqual(
            extract_retry_after(Exception("RESOURCE_EXHAUSTED. Please retry-after: 50s")), 50.0
        )
        self.assertEqual(
            extract_retry_after(Exception("Rate limit reached. retryDelay = 25")), 25.0
        )
        self.assertIsNone(extract_retry_after(Exception("Generic error without retry info")))

    async def test_mock_client_simulate_rate_limit(self) -> None:
        """Verify MockGeminiImageClient rate limit simulation and cooldown tracking."""
        client = MockGeminiImageClient(simulate_rate_limit=True, cooldown_seconds=30.0)
        self.assertFalse(client.is_rate_limited)

        # 1. Initial call triggers 429 simulation and activates cooldown
        res1 = await client.generate_image("Chore 1")
        self.assertIsNone(res1)
        self.assertTrue(client.is_rate_limited)
        self.assertGreater(client.rate_limit_cooldown_remaining, 0.0)
        self.assertEqual(client.call_count, 1)

        # 2. Immediate second call returns None due to active cooldown
        res2 = await client.generate_image("Chore 2")
        self.assertIsNone(res2)
        self.assertEqual(client.call_count, 2)

        # 3. Manual reset clears cooldown
        client.reset_rate_limit()
        self.assertFalse(client.is_rate_limited)
        self.assertEqual(client.rate_limit_cooldown_remaining, 0.0)

    async def test_mock_client_simulate_429_alias(self) -> None:
        """Verify simulate_429 alias triggers rate limit cooldown."""
        client = MockGeminiImageClient(simulate_429=True)
        res = await client.generate_image("Chore")
        self.assertIsNone(res)
        self.assertTrue(client.is_rate_limited)

    async def test_mock_client_trigger_rate_limit_manually(self) -> None:
        """Verify manually triggering rate limit cooldown on MockGeminiImageClient."""
        client = MockGeminiImageClient()
        self.assertFalse(client.is_rate_limited)

        client.trigger_rate_limit(cooldown_seconds=15.0)
        self.assertTrue(client.is_rate_limited)
        self.assertGreater(client.rate_limit_cooldown_remaining, 0.0)

        # Generating during cooldown returns None immediately
        res = await client.generate_image("Chore")
        self.assertIsNone(res)

    async def test_google_client_handles_429_and_enters_cooldown(self) -> None:
        """Verify GoogleGenAIImageClient detects 429, enters cooldown, and backs off."""
        with patch("jira_dashboard.adapters.gemini_client.genai") as mock_genai_mod:
            mock_client_instance = mock_genai_mod.Client.return_value

            # Simulate a 429 ClientError with retryDelay in message
            class MockClient429Error(Exception):
                code = 429

            rate_limit_exc = MockClient429Error(
                "429 RESOURCE_EXHAUSTED: Quota exceeded. retryDelay: 40s"
            )
            mock_client_instance.models.generate_content.side_effect = rate_limit_exc

            client = GoogleGenAIImageClient(
                api_key="fake-key",
                model="gemini-3.1-flash-lite-image",
                default_cooldown_seconds=60.0,
            )
            self.assertFalse(client.is_rate_limited)

            # 1. First call fails with 429 and enters cooldown based on parsed retryDelay
            res1 = await client.generate_image("Clean kitchen")
            self.assertIsNone(res1)
            self.assertTrue(client.is_rate_limited)
            # Should have set cooldown close to 40s
            self.assertGreater(client.rate_limit_cooldown_remaining, 35.0)
            mock_client_instance.models.generate_content.assert_called_once()

            # 2. Second call during cooldown returns None WITHOUT hitting Google client again
            mock_client_instance.models.generate_content.reset_mock()
            res2 = await client.generate_image("Fold laundry")
            self.assertIsNone(res2)
            mock_client_instance.models.generate_content.assert_not_called()

            # 3. Reset rate limit and verify it calls Google client again
            client.reset_rate_limit()
            mock_part = unittest.mock.MagicMock()
            mock_part.inline_data.data = b"recovered-image-bytes"
            mock_response = unittest.mock.MagicMock()
            mock_response.parts = [mock_part]
            mock_client_instance.models.generate_content.side_effect = None
            mock_client_instance.models.generate_content.return_value = mock_response

            res3 = await client.generate_image("Fold laundry")
            self.assertEqual(res3, b"recovered-image-bytes")
            mock_client_instance.models.generate_content.assert_called_once()

    def test_factory_sets_cooldown_from_settings(self) -> None:
        """Verify create_gemini_client configures default_cooldown_seconds from settings."""
        settings = JiraDashboardSettings(
            gemini_api_key="mock",
            gemini_cooldown_seconds=120,
        )
        client = create_gemini_client(settings)
        self.assertIsInstance(client, MockGeminiImageClient)
        self.assertEqual(client.default_cooldown_seconds, 120.0)
