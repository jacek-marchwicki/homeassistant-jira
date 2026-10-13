# Home Assistant Jira Dashboard Add-on

A real-time, responsive Jira Dashboard with Optimistic UI (<50ms mutations), bidirectional WebSocket updates, and seamless Home Assistant Ingress integration.

## Features

- **Home Assistant Ingress**: Access directly inside Home Assistant's web and mobile apps without opening ports.
- **Home Assistant Theme Bridge**: Automatically detects and adapts to Home Assistant theme tokens (`--primary-background-color`, `--ha-card-background`, `--accent-color`, etc.).
- **Optimistic UI (<50ms)**: Move cards, edit fields, and post comments instantly with background sync and rollback queue.
- **Real-Time Synchronization**: Instant state synchronization across desktop, wallboard displays, and mobile devices.
- **Wallboard Kiosk Mode**: Ambient fullscreen display mode for high-visibility office or wall screens.
- **Jira Cloud & Data Center Support**: Authenticate using Jira Cloud API Tokens or Jira Data Center Personal Access Tokens (PAT).
- **Pre-Built Multi-Architecture Images**: Automatically downloads pre-compiled images from GHCR without on-device build delays.

---

## Configuration

Configure the add-on through the **Configuration** tab in Home Assistant.

### Example Configuration (Jira Cloud with Gemini AI Backgrounds)

```yaml
jira_url: "https://mycompany.atlassian.net"
jira_email: "alex@mycompany.com"
jira_api_token: "ATATT3xFfGF0exampletoken123"
jira_board_id: "42"
polling_interval_seconds: 60
gemini_api_key: "AIzaSy..."
gemini_model: "gemini-3.1-flash-lite-image"
gemini_daily_limit: 100
gemini_debounce_seconds: 300
gemini_cache_retention_seconds: 2592000
```

### Configuration Options

| Option | Type | Required | Description |
|---|---|---|---|
| `jira_url` | URL | Yes | Base URL of your Jira Cloud instance (e.g. `https://mycompany.atlassian.net`). |
| `jira_email` | String | Yes | Your Atlassian account email address for basic authentication. |
| `jira_api_token` | Password | Yes | Jira Cloud API Token ([generate here](https://id.atlassian.com/manage-profile/security/api-tokens)). |
| `jira_board_id` | String | No | Target Jira Agile Board ID (defaults to primary board if empty). |
| `polling_interval_seconds` | Integer | No | Fallback polling interval in seconds (default: `60`). Set `0` to disable. |
| `gemini_api_key` | Password | No | Google GenAI / Gemini API key for AI task illustration backgrounds ([get here](https://aistudio.google.com/app/apikey)). Leave empty to disable. |
| `gemini_model` | String | No | Gemini image model identifier (default: `gemini-3.1-flash-lite-image`). |
| `gemini_prompt_template` | String | No | Prompt template for kid-friendly illustrations. Use `{summary}` placeholder. |
| `gemini_daily_limit` | Integer | No | Max daily AI generations to control costs (default: `100`). |
| `gemini_debounce_seconds` | Integer | No | Settle debounce delay in seconds after task edits (default: `300`). |
| `gemini_cache_retention_seconds` | Integer | No | Cache retention period in seconds before pruning (default: `2592000` / 30 days). |

---

## How to Obtain a Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account and click **Get API key** / **Create API key**.
3. Copy the generated API key and paste it into the `gemini_api_key` field in the add-on Configuration tab.
4. If left blank, the dashboard functions normally with solid/gradient cards without making external AI generation calls.

---

## How to Obtain a Jira API Token

1. Log in to [Atlassian Account Security](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token**.
3. Label it (e.g. `Home Assistant Jira Dashboard`).
4. Copy the generated token and paste it into the `jira_api_token` configuration field.

---

## Usage in Home Assistant

1. In the add-on's **Info** tab, toggle **Show in sidebar** to ON.
2. Click **Start**.
3. Click **Open Web UI** or click **Jira** in the left Home Assistant navigation sidebar.
4. The dashboard will load directly within the Home Assistant interface, styled to match your active Home Assistant theme.

> [!NOTE]
> The add-on is configured with `panel_admin: false`, making the Jira sidebar entry visible to all Home Assistant users (including non-administrator accounts) when **Show in sidebar** is enabled.
