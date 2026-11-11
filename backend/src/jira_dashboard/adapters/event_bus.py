"""Pluggable event bus abstraction for multi-instance notifications (GCP Pub/Sub & Mosquitto MQTT).

Provides a lightweight WAKE_UP signaling mechanism so distributed instances
can invalidate board state, fetch missed outbox events from persistent storage,
and fan out updates to connected WebSockets without message loss.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from jira_dashboard.config import JiraDashboardSettings

logger = logging.getLogger(__name__)


@runtime_checkable
class EventBusProtocol(Protocol):
    """Abstract interface for event bus implementations."""

    async def publish_wake_up(self, board_id: str, seq: int) -> None:
        """Publish a lightweight WAKE_UP notification for a board."""
        ...

    async def start_listening(self, on_wake_up: Callable[[str, int], Awaitable[None]]) -> None:
        """Start listening for incoming WAKE_UP notifications."""
        ...

    async def stop_listening(self) -> None:
        """Stop listening and clean up underlying resources or subscriptions."""
        ...


class InMemoryEventBus:
    """In-memory event bus implementation for testing and single-instance deployments."""

    def __init__(self) -> None:
        self._listeners: list[Callable[[str, int], Awaitable[None]]] = []

    async def publish_wake_up(self, board_id: str, seq: int) -> None:
        for listener in list(self._listeners):
            try:
                res = listener(board_id, seq)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as exc:
                logger.error("Error in InMemoryEventBus listener: %s", exc)

    async def start_listening(self, on_wake_up: Callable[[str, int], Awaitable[None]]) -> None:
        if on_wake_up not in self._listeners:
            self._listeners.append(on_wake_up)

    async def stop_listening(self) -> None:
        self._listeners.clear()


class GCPPubSubEventBus:
    """GCP Pub/Sub event bus with ephemeral subscriptions for Cloud Run instances."""

    def __init__(
        self,
        settings: JiraDashboardSettings,
        publisher: Any = None,
        subscriber: Any = None,
    ) -> None:
        self.project_id = settings.gcp_project_id or "default"
        self.topic_name = settings.gcp_pubsub_topic or "jira-dashboard-wake-up"
        self._publisher: Any = publisher
        self._subscriber: Any = subscriber
        self._subscription_name: str | None = None
        self._streaming_future: Any = None
        self._callback: Callable[[str, int], Awaitable[None]] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def subscription_name(self) -> str | None:
        return self._subscription_name

    def _get_publisher(self) -> Any:
        if self._publisher is None:
            from google.cloud import pubsub_v1

            self._publisher = pubsub_v1.PublisherClient()
        return self._publisher

    def _get_subscriber(self) -> Any:
        if self._subscriber is None:
            from google.cloud import pubsub_v1

            self._subscriber = pubsub_v1.SubscriberClient()
        return self._subscriber

    def _get_topic_path(self) -> str:
        pub = self._get_publisher()
        if hasattr(pub, "topic_path"):
            return str(pub.topic_path(self.project_id, self.topic_name))
        return f"projects/{self.project_id}/topics/{self.topic_name}"

    async def publish_wake_up(self, board_id: str, seq: int) -> None:
        pub = self._get_publisher()
        topic_path = self._get_topic_path()
        payload = {
            "type": "WAKE_UP",
            "board_id": board_id,
            "seq": seq,
        }
        data = json.dumps(payload).encode("utf-8")
        future = pub.publish(topic_path, data=data)
        if hasattr(future, "result"):
            # Avoid blocking event loop if future is synchronous or thread-based
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, future.result)
            except RuntimeError:
                future.result()

    async def start_listening(self, on_wake_up: Callable[[str, int], Awaitable[None]]) -> None:
        self._callback = on_wake_up
        self._loop = asyncio.get_running_loop()
        sub = self._get_subscriber()
        topic_path = self._get_topic_path()

        ephemeral_id = f"run-sub-{uuid.uuid4().hex[:12]}"
        if hasattr(sub, "subscription_path"):
            self._subscription_name = str(sub.subscription_path(self.project_id, ephemeral_id))
        else:
            self._subscription_name = f"projects/{self.project_id}/subscriptions/{ephemeral_id}"

        try:
            sub.create_subscription(
                request={
                    "name": self._subscription_name,
                    "topic": topic_path,
                    "message_retention_duration": {"seconds": 3600},
                }
            )
        except Exception as exc:
            logger.warning(
                "Could not create ephemeral subscription %s: %s",
                self._subscription_name,
                exc,
            )

        def _sub_callback(message: Any) -> None:
            try:
                payload = json.loads(message.data.decode("utf-8"))
                if payload.get("type") == "WAKE_UP":
                    board_id = payload.get("board_id", "")
                    seq = int(payload.get("seq", 0))
                    if self._callback and self._loop and self._loop.is_running():
                        asyncio.run_coroutine_threadsafe(self._callback(board_id, seq), self._loop)
                message.ack()
            except Exception as err:
                logger.error("Error processing GCP PubSub message: %s", err)
                message.nack()

        self._streaming_future = sub.subscribe(self._subscription_name, callback=_sub_callback)

    async def stop_listening(self) -> None:
        if self._streaming_future is not None:
            try:
                self._streaming_future.cancel()
            except Exception:
                pass
            self._streaming_future = None

        if self._subscription_name and self._subscriber is not None:
            try:
                self._subscriber.delete_subscription(
                    request={"subscription": self._subscription_name}
                )
            except Exception as exc:
                logger.debug(
                    "Error deleting ephemeral subscription %s: %s",
                    self._subscription_name,
                    exc,
                )
            self._subscription_name = None


class MosquittoMQTTEventBus:
    """MQTT event bus connecting to Mosquitto (Home Assistant Add-on or local broker)."""

    def __init__(self, settings: JiraDashboardSettings, client: Any = None) -> None:
        self.broker_url = settings.mqtt_broker_url or "mqtt://localhost:1883"
        self.topic = settings.mqtt_topic or "homeassistant/jira_dashboard/events/wake_up"
        self._client: Any = client
        if self._client is not None:
            self._client.on_message = self._handle_mqtt_message
        self._callback: Callable[[str, int], Awaitable[None]] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import paho.mqtt.client as mqtt

                self._client = mqtt.Client()
                self._client.on_message = self._handle_mqtt_message
            except ImportError:
                logger.warning("paho-mqtt not installed; MosquittoMQTTEventBus is inactive")
                self._client = None
        return self._client

    def _handle_mqtt_message(self, client: Any, userdata: Any, msg: Any) -> None:
        try:
            raw = msg.payload.decode("utf-8")
            data = json.loads(raw)
            if data.get("type") == "WAKE_UP":
                board_id = data.get("board_id", "")
                seq = int(data.get("seq", 0))
                if self._callback:
                    try:
                        current_loop = asyncio.get_running_loop()
                    except RuntimeError:
                        current_loop = None

                    if current_loop is not None and current_loop == self._loop:
                        asyncio.create_task(self._callback(board_id, seq))
                    elif self._loop and self._loop.is_running():
                        asyncio.run_coroutine_threadsafe(self._callback(board_id, seq), self._loop)
                    else:
                        coro = self._callback(board_id, seq)
                        if asyncio.iscoroutine(coro):
                            asyncio.create_task(coro)
        except Exception as exc:
            logger.error(
                "Error handling MQTT message on %s: %s",
                getattr(msg, "topic", "unknown"),
                exc,
            )

    async def publish_wake_up(self, board_id: str, seq: int) -> None:
        client = self._get_client()
        if client is None:
            return
        payload = json.dumps(
            {
                "type": "WAKE_UP",
                "board_id": board_id,
                "seq": seq,
            }
        )
        client.publish(self.topic, payload)

    async def start_listening(self, on_wake_up: Callable[[str, int], Awaitable[None]]) -> None:
        self._callback = on_wake_up
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        client = self._get_client()
        if client is None:
            return

        client.subscribe(self.topic)
        # In a real broker scenario with paho-mqtt, loop_start runs in background thread
        if hasattr(client, "loop_start"):
            client.loop_start()

    async def stop_listening(self) -> None:
        if self._client is not None:
            if hasattr(self._client, "loop_stop"):
                self._client.loop_stop()
            if hasattr(self._client, "disconnect"):
                self._client.disconnect()
            self._client = None
