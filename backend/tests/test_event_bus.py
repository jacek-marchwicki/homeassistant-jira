"""Unit tests for EventBusProtocol and its adapters (InMemory, GCP PubSub, Mosquitto MQTT)."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

from jira_dashboard.config import JiraDashboardSettings


def test_in_memory_event_bus_publish_and_listen() -> None:
    async def _test() -> None:
        from jira_dashboard.adapters.event_bus import InMemoryEventBus

        bus = InMemoryEventBus()
        received: list[tuple[str, int]] = []

        async def callback(board_id: str, seq: int) -> None:
            received.append((board_id, seq))

        await bus.start_listening(callback)
        await bus.publish_wake_up("eng-1", 42)
        await bus.publish_wake_up("eng-1", 43)

        assert len(received) == 2
        assert received[0] == ("eng-1", 42)
        assert received[1] == ("eng-1", 43)

        await bus.stop_listening()
        # Publishing after stop should not trigger listener
        await bus.publish_wake_up("eng-1", 44)
        assert len(received) == 2

    asyncio.run(_test())


def test_gcp_pubsub_event_bus_lifecycle() -> None:
    async def _test() -> None:
        from jira_dashboard.adapters.event_bus import GCPPubSubEventBus

        settings = JiraDashboardSettings(
            gcp_project_id="test-project",
            gcp_pubsub_topic="jira-wake-up",
        )

        mock_publisher = MagicMock()
        mock_future = MagicMock()
        mock_future.result = MagicMock(return_value="msg-id-123")
        mock_publisher.publish.return_value = mock_future
        mock_publisher.topic_path = MagicMock(
            return_value="projects/test-project/topics/jira-wake-up"
        )

        mock_subscriber = MagicMock()
        mock_subscriber.create_subscription = MagicMock()
        mock_subscriber.delete_subscription = MagicMock()
        mock_subscriber.subscription_path = MagicMock(
            side_effect=lambda proj, sub: f"projects/{proj}/subscriptions/{sub}"
        )
        mock_stream_future = MagicMock()
        mock_subscriber.subscribe.return_value = mock_stream_future

        bus = GCPPubSubEventBus(settings, publisher=mock_publisher, subscriber=mock_subscriber)
        await bus.publish_wake_up("eng-1", 99)

        # Verify publish called with correct topic and JSON data
        mock_publisher.publish.assert_called_once()
        call_args = mock_publisher.publish.call_args
        assert "projects/test-project/topics/jira-wake-up" in call_args[0][0]
        data = json.loads(call_args[1]["data"].decode("utf-8"))
        assert data["type"] == "WAKE_UP"
        assert data["board_id"] == "eng-1"
        assert data["seq"] == 99

        # Start listening creates ephemeral subscription
        cb = AsyncMock()
        await bus.start_listening(cb)
        mock_subscriber.create_subscription.assert_called_once()
        sub_name = bus.subscription_name
        assert sub_name is not None
        assert "projects/test-project/subscriptions/run-sub-" in sub_name

        # Stop listening cleans up subscription
        await bus.stop_listening()
        mock_stream_future.cancel.assert_called_once()
        mock_subscriber.delete_subscription.assert_called_once_with(
            request={"subscription": sub_name}
        )

    asyncio.run(_test())


def test_mosquitto_mqtt_event_bus_lifecycle() -> None:
    async def _test() -> None:
        from jira_dashboard.adapters.event_bus import MosquittoMQTTEventBus

        settings = JiraDashboardSettings(
            mqtt_broker_url="mqtt://localhost:1883",
            mqtt_topic="homeassistant/jira_dashboard/events/wake_up",
        )

        mock_client = MagicMock()
        bus = MosquittoMQTTEventBus(settings, client=mock_client)

        # Test publish
        await bus.publish_wake_up("board-ha", 15)
        mock_client.publish.assert_called_once()
        topic, payload_str = mock_client.publish.call_args[0][:2]
        assert topic == "homeassistant/jira_dashboard/events/wake_up"
        data = json.loads(payload_str)
        assert data["type"] == "WAKE_UP"
        assert data["board_id"] == "board-ha"
        assert data["seq"] == 15

        # Test listening callback
        received: list[tuple[str, int]] = []

        async def callback(board_id: str, seq: int) -> None:
            received.append((board_id, seq))

        await bus.start_listening(callback)
        mock_client.subscribe.assert_called_once_with("homeassistant/jira_dashboard/events/wake_up")

        # Simulate on_message event
        fake_msg = MagicMock()
        fake_msg.payload = json.dumps(
            {"type": "WAKE_UP", "board_id": "board-ha", "seq": 15}
        ).encode("utf-8")
        bus._handle_mqtt_message(mock_client, None, fake_msg)
        await asyncio.sleep(0.01)

        assert len(received) == 1
        assert received[0] == ("board-ha", 15)

        await bus.stop_listening()
        mock_client.disconnect.assert_called_once()

    asyncio.run(_test())


def test_create_event_bus_factory() -> None:
    from jira_dashboard.adapters.event_bus import (
        GCPPubSubEventBus,
        InMemoryEventBus,
        MosquittoMQTTEventBus,
    )
    from jira_dashboard.adapters.factory import create_event_bus

    # Default -> InMemoryEventBus
    bus1 = create_event_bus(JiraDashboardSettings())
    assert isinstance(bus1, InMemoryEventBus)

    # PubSub configured -> GCPPubSubEventBus
    bus2 = create_event_bus(
        JiraDashboardSettings(
            event_bus_backend="pubsub",
            gcp_project_id="my-proj",
        )
    )
    assert isinstance(bus2, GCPPubSubEventBus)

    # MQTT configured -> MosquittoMQTTEventBus
    bus3 = create_event_bus(
        JiraDashboardSettings(
            event_bus_backend="mqtt",
            mqtt_broker_url="mqtt://core-mosquitto:1883",
        )
    )
    assert isinstance(bus3, MosquittoMQTTEventBus)
