"""Home Assistant WebSocket Cloudhook Manager & Listener.

Connects to Home Assistant Core via WebSocket API (e.g. ws://supervisor/core/websocket),
authenticates with SUPERVISOR_TOKEN, provisions or resolves Nabu Casa Cloudhook endpoints,
and subscribes to incoming webhook trigger events.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import websockets

logger = logging.getLogger(__name__)


class HomeAssistantCloudhookManager:
    """Manages Home Assistant WebSocket API connection, Cloudhooks, and webhook triggers."""

    def __init__(
        self,
        ws_url: str = "ws://supervisor/core/websocket",
        supervisor_token: str | None = None,
        webhook_id: str = "jira_home_tasks_webhook_01",
        webhook_secret: str | None = None,
        on_payload: Callable[[dict[str, Any]], Awaitable[Any]] | None = None,
        on_cloudhook_resolved: Callable[[str], Awaitable[Any]] | None = None,
        reconnect_delay: float = 2.0,
        max_reconnect_delay: float = 30.0,
    ) -> None:
        self.ws_url = ws_url
        self.supervisor_token = supervisor_token
        self.webhook_id = webhook_id
        self.webhook_secret = webhook_secret
        self.on_payload = on_payload
        self.on_cloudhook_resolved = on_cloudhook_resolved
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_delay = max_reconnect_delay

        self.cloudhook_url: str | None = None
        self._msg_id: int = 0
        self._pending_commands: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._subscription_id: int | None = None
        self._is_connected: bool = False

    @property
    def is_connected(self) -> bool:
        """Return True if currently connected and subscribed to HA WebSocket."""
        return self._is_connected

    def _next_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    async def _send_command(
        self,
        ws: Any,
        cmd_type: str,
        timeout: float = 10.0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Send a command over WebSocket and await matching response ID."""
        msg_id = self._next_id()
        payload = {"id": msg_id, "type": cmd_type, **kwargs}
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending_commands[msg_id] = future
        try:
            await ws.send(json.dumps(payload))
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending_commands.pop(msg_id, None)

    async def _handle_incoming_event(self, data: dict[str, Any]) -> None:
        """Process event pushed by Home Assistant trigger subscription."""
        event = data.get("event") or {}
        variables = event.get("variables") or {}
        trigger = variables.get("trigger") or {}

        if trigger.get("platform") != "webhook":
            return
        if trigger.get("webhook_id") != self.webhook_id:
            return

        # 1. Validate Secret Token if configured and query parameter was provided
        query_params = trigger.get("query") or {}
        query_secret = query_params.get("secret")
        if self.webhook_secret and query_secret is not None:
            if query_secret != self.webhook_secret:
                logger.warning(
                    "Home Assistant webhook trigger received with invalid secret token "
                    "(expected: %s, got: %s)",
                    "***" if self.webhook_secret else None,
                    query_secret,
                )
                return

        # 2. Extract Jira Webhook Payload
        payload = trigger.get("json")
        if payload is None:
            raw_data = trigger.get("data")
            if isinstance(raw_data, str):
                try:
                    payload = json.loads(raw_data)
                except Exception:
                    pass
            elif isinstance(raw_data, dict):
                payload = raw_data

        if isinstance(payload, dict) and self.on_payload:
            try:
                await self.on_payload(payload)
            except Exception as exc:
                logger.exception("Error executing on_payload for HA webhook event: %s", exc)

    async def _read_loop(self, ws: Any) -> None:
        """Continuous message pump for active WebSocket connection."""
        async for raw_msg in ws:
            try:
                data = json.loads(raw_msg)
            except Exception:
                continue

            msg_type = data.get("type")

            # Handle HA ping/pong heartbeats
            if msg_type == "ping":
                pong_msg: dict[str, Any] = {"type": "pong"}
                if "id" in data:
                    pong_msg["id"] = data["id"]
                await ws.send(json.dumps(pong_msg))
                continue

            # Resolve pending command futures
            if msg_type == "result":
                msg_id = data.get("id")
                future = self._pending_commands.get(msg_id)
                if future and not future.done():
                    future.set_result(data)
                continue

            # Process trigger events
            if msg_type == "event":
                await self._handle_incoming_event(data)

    async def _authenticate(self, ws: Any) -> None:
        """Perform Home Assistant WebSocket authentication handshake."""
        raw_init = await asyncio.wait_for(ws.recv(), timeout=10.0)
        init_data = json.loads(raw_init)
        if init_data.get("type") == "auth_required":
            if not self.supervisor_token:
                raise ValueError("HA WebSocket requires auth, but no SUPERVISOR_TOKEN provided.")
            auth_msg = {
                "type": "auth",
                "access_token": self.supervisor_token,
            }
            await ws.send(json.dumps(auth_msg))
            raw_auth_res = await asyncio.wait_for(ws.recv(), timeout=10.0)
            auth_res = json.loads(raw_auth_res)
            if auth_res.get("type") != "auth_ok":
                raise ValueError(f"HA WebSocket authentication failed: {auth_res}")
            logger.info("Successfully authenticated with Home Assistant WebSocket API")

    async def _resolve_or_create_cloudhook(self, ws: Any) -> str | None:
        """Query Nabu Casa cloud status or create new cloudhook for webhook_id."""
        try:
            status_res = await self._send_command(ws, "cloud/status")
            if not status_res.get("success"):
                logger.info("HA cloud/status query returned: %s", status_res)
                return None

            result_data = status_res.get("result") or {}
            cloudhooks = (
                result_data.get("cloudhooks")
                or (result_data.get("prefs") or {}).get("cloudhooks")
                or {}
            )

            hook_entry = cloudhooks.get(self.webhook_id)
            if isinstance(hook_entry, dict) and "cloudhook_url" in hook_entry:
                return str(hook_entry["cloudhook_url"])
            if isinstance(hook_entry, str):
                return hook_entry

            # If logged into Nabu Casa cloud, create the cloudhook
            if result_data.get("logged_in"):
                logger.info("Creating Nabu Casa Cloudhook for webhook '%s'", self.webhook_id)
                create_res = await self._send_command(
                    ws, "cloud/cloudhook/create", webhook_id=self.webhook_id
                )
                if create_res.get("success"):
                    c_res = create_res.get("result") or {}
                    if isinstance(c_res, dict) and "cloudhook_url" in c_res:
                        return str(c_res["cloudhook_url"])
                    if isinstance(c_res, str):
                        return c_res
        except Exception as exc:
            logger.warning("Could not resolve or create Nabu Casa Cloudhook: %s", exc)

        return None

    async def _subscribe_webhook_trigger(self, ws: Any) -> None:
        """Subscribe to HA webhook trigger via subscribe_trigger command."""
        sub_res = await self._send_command(
            ws,
            "subscribe_trigger",
            trigger={
                "platform": "webhook",
                "webhook_id": self.webhook_id,
                "allowed_methods": ["POST", "PUT"],
                "local_only": False,
            },
        )
        if not sub_res.get("success"):
            raise RuntimeError(f"Failed subscribing to HA webhook trigger: {sub_res}")

        self._subscription_id = sub_res.get("id")
        self._is_connected = True
        logger.info(
            "Subscribed to Home Assistant webhook trigger '%s' (id=%s)",
            self.webhook_id,
            self._subscription_id,
        )

    async def run(self, stop_event: asyncio.Event) -> None:
        """Run connection loop with exponential backoff until stop_event is set."""
        current_delay = self.reconnect_delay

        while not stop_event.is_set():
            reader_task: asyncio.Task[None] | None = None
            try:
                logger.info("Connecting to Home Assistant WebSocket at %s", self.ws_url)
                async with websockets.connect(self.ws_url) as ws:
                    await self._authenticate(ws)

                    # Start reader pump
                    reader_task = asyncio.create_task(self._read_loop(ws))

                    # Resolve / create Cloudhook
                    resolved_url = await self._resolve_or_create_cloudhook(ws)
                    if resolved_url:
                        self.cloudhook_url = resolved_url
                        logger.info("Resolved Nabu Casa Cloudhook URL: %s", self.cloudhook_url)
                        if self.on_cloudhook_resolved:
                            try:
                                await self.on_cloudhook_resolved(self.cloudhook_url)
                            except Exception as exc:
                                logger.exception("Error in on_cloudhook_resolved callback: %s", exc)

                    # Subscribe to webhook trigger
                    await self._subscribe_webhook_trigger(ws)

                    # Reset reconnection backoff upon successful connection
                    current_delay = self.reconnect_delay

                    # Stay connected until stopped or reader task finishes/fails
                    while not stop_event.is_set():
                        if reader_task.done():
                            reader_task.result()  # Raise exception if failed
                            break
                        await asyncio.sleep(0.5)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._is_connected = False
                logger.warning(
                    "Home Assistant WebSocket connection error: %s. Retrying in %.1fs...",
                    exc,
                    current_delay,
                )
            finally:
                self._is_connected = False
                if reader_task and not reader_task.done():
                    reader_task.cancel()
                    try:
                        await reader_task
                    except (asyncio.CancelledError, Exception):
                        pass

            if not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=current_delay)
                except asyncio.TimeoutError:
                    pass
                current_delay = min(current_delay * 1.5, self.max_reconnect_delay)
