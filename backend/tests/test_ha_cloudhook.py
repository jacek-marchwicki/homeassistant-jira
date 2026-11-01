"""Integration tests for Home Assistant Cloudhook Manager with Mock HA WebSocket Server."""

from __future__ import annotations

import asyncio
import json
import unittest
from typing import Any

import websockets

from jira_dashboard.adapters.ha_cloudhook import HomeAssistantCloudhookManager


class TestHomeAssistantCloudhookManager(unittest.IsolatedAsyncioTestCase):
    """Test suite verifying Home Assistant WebSocket API interaction and cloudhook lifecycle."""

    async def asyncSetUp(self) -> None:
        self.received_payloads: list[dict[str, Any]] = []
        self.resolved_urls: list[str] = []
        self.server_received_messages: list[dict[str, Any]] = []

    async def test_full_cloudhook_lifecycle(self) -> None:
        """Verify auth, cloudhook provisioning, subscription, and event streaming."""
        cloudhook_url_to_return = "https://hooks.nabu.casa/abc-123-xyz"

        async def ha_server_handler(ws: Any) -> None:
            # 1. Send auth_required
            await ws.send(json.dumps({"type": "auth_required", "ha_version": "2024.1.0"}))
            auth_req = json.loads(await ws.recv())
            self.server_received_messages.append(auth_req)
            if auth_req.get("type") == "auth" and auth_req.get("access_token") == "test-token":
                await ws.send(json.dumps({"type": "auth_ok", "ha_version": "2024.1.0"}))
            else:
                await ws.send(json.dumps({"type": "auth_invalid", "message": "Invalid token"}))
                return

            # Message loop
            async for raw in ws:
                msg = json.loads(raw)
                self.server_received_messages.append(msg)
                msg_type = msg.get("type")

                if msg_type == "cloud/status":
                    # Simulate logged into Nabu Casa, but no cloudhook for this webhook_id yet
                    await ws.send(
                        json.dumps(
                            {
                                "id": msg["id"],
                                "type": "result",
                                "success": True,
                                "result": {"logged_in": True, "prefs": {"cloudhooks": {}}},
                            }
                        )
                    )
                elif msg_type == "cloud/cloudhook/create":
                    await ws.send(
                        json.dumps(
                            {
                                "id": msg["id"],
                                "type": "result",
                                "success": True,
                                "result": {"cloudhook_url": cloudhook_url_to_return},
                            }
                        )
                    )
                elif msg_type == "subscribe_trigger":
                    sub_id = msg["id"]
                    await ws.send(
                        json.dumps(
                            {
                                "id": sub_id,
                                "type": "result",
                                "success": True,
                                "result": None,
                            }
                        )
                    )
                    # Push a valid webhook trigger event
                    await ws.send(
                        json.dumps(
                            {
                                "id": sub_id,
                                "type": "event",
                                "event": {
                                    "variables": {
                                        "trigger": {
                                            "platform": "webhook",
                                            "webhook_id": "jira_home_tasks_webhook_01",
                                            "query": {"secret": "my-secret-key"},
                                            "json": {
                                                "webhookEvent": "jira:issue_updated",
                                                "issue": {"id": "100", "key": "HOME-100"},
                                            },
                                        }
                                    }
                                },
                            }
                        )
                    )

        server = await websockets.serve(ha_server_handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        server_ws_url = f"ws://127.0.0.1:{port}"

        async def on_payload(payload: dict[str, Any]) -> None:
            self.received_payloads.append(payload)

        async def on_cloudhook_resolved(url: str) -> None:
            self.resolved_urls.append(url)

        stop_event = asyncio.Event()
        mgr = HomeAssistantCloudhookManager(
            ws_url=server_ws_url,
            supervisor_token="test-token",
            webhook_id="jira_home_tasks_webhook_01",
            webhook_secret="my-super-secret",  # Will test secret match next
        )
        mgr.webhook_secret = "my-secret-key"
        mgr.on_payload = on_payload
        mgr.on_cloudhook_resolved = on_cloudhook_resolved

        task = asyncio.create_task(mgr.run(stop_event))

        # Wait for payload reception
        for _ in range(50):
            if self.received_payloads:
                break
            await asyncio.sleep(0.05)

        stop_event.set()
        await task
        server.close()
        await server.wait_closed()

        self.assertEqual(len(self.resolved_urls), 1)
        self.assertEqual(self.resolved_urls[0], cloudhook_url_to_return)
        self.assertEqual(len(self.received_payloads), 1)
        self.assertEqual(self.received_payloads[0]["issue"]["key"], "HOME-100")

    async def test_cloudhook_secret_rejection(self) -> None:
        """Verify webhook event is dropped when secret query param does not match."""

        async def ha_server_handler(ws: Any) -> None:
            await ws.send(json.dumps({"type": "auth_required"}))
            await ws.recv()
            await ws.send(json.dumps({"type": "auth_ok"}))

            async for raw in ws:
                msg = json.loads(raw)
                msg_type = msg.get("type")
                if msg_type == "cloud/status":
                    await ws.send(
                        json.dumps(
                            {
                                "id": msg["id"],
                                "type": "result",
                                "success": True,
                                "result": {"logged_in": False},
                            }
                        )
                    )
                elif msg_type == "subscribe_trigger":
                    sub_id = msg["id"]
                    await ws.send(json.dumps({"id": sub_id, "type": "result", "success": True}))
                    # Push event with WRONG secret
                    await ws.send(
                        json.dumps(
                            {
                                "id": sub_id,
                                "type": "event",
                                "event": {
                                    "variables": {
                                        "trigger": {
                                            "platform": "webhook",
                                            "webhook_id": "jira_home_tasks_webhook_01",
                                            "query": {"secret": "wrong-secret"},
                                            "json": {"issue": {"key": "HOME-999"}},
                                        }
                                    }
                                },
                            }
                        )
                    )

        server = await websockets.serve(ha_server_handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        server_ws_url = f"ws://127.0.0.1:{port}"

        async def on_payload(payload: dict[str, Any]) -> None:
            self.received_payloads.append(payload)

        stop_event = asyncio.Event()
        mgr = HomeAssistantCloudhookManager(
            ws_url=server_ws_url,
            supervisor_token="test-token",
            webhook_id="jira_home_tasks_webhook_01",
            webhook_secret="expected-secret",
            on_payload=on_payload,
        )

        task = asyncio.create_task(mgr.run(stop_event))

        # Wait a bit and verify nothing received
        await asyncio.sleep(0.3)
        stop_event.set()
        await task
        server.close()
        await server.wait_closed()

        self.assertEqual(len(self.received_payloads), 0)

    async def test_existing_cloudhook_resolved_without_create_call(self) -> None:
        """Verify existing cloudhooks in cloud/status result are used directly."""
        existing_url = "https://hooks.nabu.casa/existing-url-789"
        created_called = False

        async def ha_server_handler(ws: Any) -> None:
            nonlocal created_called
            await ws.send(json.dumps({"type": "auth_required"}))
            await ws.recv()
            await ws.send(json.dumps({"type": "auth_ok"}))

            async for raw in ws:
                msg = json.loads(raw)
                msg_type = msg.get("type")
                if msg_type == "cloud/status":
                    await ws.send(
                        json.dumps(
                            {
                                "id": msg["id"],
                                "type": "result",
                                "success": True,
                                "result": {
                                    "logged_in": True,
                                    "cloudhooks": {
                                        "jira_home_tasks_webhook_01": {
                                            "cloudhook_url": existing_url
                                        }
                                    },
                                },
                            }
                        )
                    )
                elif msg_type == "cloud/cloudhook/create":
                    created_called = True
                    await ws.send(json.dumps({"id": msg["id"], "type": "result", "success": True}))
                elif msg_type == "subscribe_trigger":
                    await ws.send(json.dumps({"id": msg["id"], "type": "result", "success": True}))

        server = await websockets.serve(ha_server_handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        server_ws_url = f"ws://127.0.0.1:{port}"

        async def on_cloudhook_resolved(url: str) -> None:
            self.resolved_urls.append(url)

        stop_event = asyncio.Event()
        mgr = HomeAssistantCloudhookManager(
            ws_url=server_ws_url,
            supervisor_token="test-token",
            webhook_id="jira_home_tasks_webhook_01",
            on_cloudhook_resolved=on_cloudhook_resolved,
        )

        task = asyncio.create_task(mgr.run(stop_event))

        for _ in range(50):
            if self.resolved_urls:
                break
            await asyncio.sleep(0.05)

        stop_event.set()
        await task
        server.close()
        await server.wait_closed()

        self.assertFalse(created_called)
        self.assertEqual(len(self.resolved_urls), 1)
        self.assertEqual(self.resolved_urls[0], existing_url)
