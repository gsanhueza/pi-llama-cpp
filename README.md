# pi-llama-cpp

A [Pi Coding Agent](https://pi.dev/) extension that integrates with running [llama.cpp servers](https://github.com/ggml-org/llama.cpp) to provide live model browsing, loading, and switching directly from Pi.

## Features

- **Auto-detect models** — discovers all models available on your running llama.cpp server
- **Live status indicators** — see which models are loaded, loading, failed, sleeping, or unloaded with color-coded icons
- **Load / unload / switch** — manage models directly from the Pi command palette
- **Multi-model router support** — works with both single-model and multi-model llama.cpp server configurations
- **Image capabilities detection** — detects multimodal models automatically
- **Flexible URL resolution** — configures the server via `llamaSettings` (project/global), environment variable, or legacy `llamaServerUrl`
- **Auth support** — allows to login into a llama.cpp server that was secured with an API key
- **Multiple server support** — connect to multiple llama.cpp servers simultaneously via `llamaSettings.servers` or semicolon-separated URLs
- **Thinking budget support** — configurable token budgets for model reasoning/thinking, mapped to Pi's thinking levels
- **Real-time progress tracking** — live loading progress via SSE (falls back to polling)

### Status Indicators

| Icon | Status       | Description                            |
| ---- | ------------ | -------------------------------------- |
| 🟢   | Loaded       | Model is active and ready to use       |
| 🟡   | Loading      | Model is currently being loaded        |
| 🔴   | Failed       | Model failed to load                   |
| 🔵   | Sleeping     | Model is available, but inactive       |
| ⚪   | Unloaded     | Model is not loaded on the server      |
| ⛔   | Unauthorized | Model can't be used (API key required) |

> **Note**: The `Sleeping` status only shows when you start your server with `llama-server --sleep-idle-seconds <n> ...`.
> This is a **llama.cpp server flag** that tells the server to put idle models to sleep after `n` seconds.
> The model awakens automatically when you send a message.

> **Note:** You can run your server with API authentication with `llama-server --api-key <your key> ...`.

## Installation

This package is a Pi extension. Install it with

```bash
pi install npm:pi-llama-cpp
```

or

```bash
pi install https://github.com/gsanhueza/pi-llama-cpp
```

## Configuration

The extension resolves the llama.cpp server configuration using the following priority order:

1. **Environment variable** — `LLAMA_SERVER_URL`
2. **`llamaSettings`** — Main configuration format in `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global)
3. **`llamaServerUrl`** — Alternative format in `.pi/settings.json` or global settings
4. **Default** — `http://127.0.0.1:8080`

### llamaSettings (Recommended)

The recommended way to configure the extension is using the `llamaSettings` key. This provides a structured way to define multiple servers with custom names and IDs, plus additional behavior options.

Add this to your `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

```json
{
  "llamaSettings": {
    "servers": [
      {
        "url": "http://127.0.0.1:8080",
        "id": "local",
        "name": "Local Server"
      },
      {
        "url": "http://10.0.0.5:8080",
        "name": "Remote Server"
      }
    ],
    "reactToModelSelect": true,
    "autoloadOnMessage": false
  }
}
```

With this config, the servers will appear in Pi as **Llama.cpp (Local Server)** and **Llama.cpp (Remote Server)**.

#### Server Options

| Option | Type   | Required | Description                                                                  |
| ------ | ------ | -------- | ---------------------------------------------------------------------------- |
| `url`  | string | Yes      | The URL of the llama.cpp server                                              |
| `id`   | string | No       | Custom provider ID (used for API key auth). Defaults to `llama-server=<url>` |
| `name` | string | No       | Display name for the server in the UI (shown as `Llama.cpp — <name>`)        |

> **Note:** If you set a custom `id`, you can use it in `~/.pi/agent/auth.json`. The extension will also fall back to the URL-based ID if no key is found for the custom `id`.

#### Settings Options

| Option               | Type    | Default | Description                                          |
| -------------------- | ------- | ------- | ---------------------------------------------------- |
| `reactToModelSelect` | boolean | `true`  | Load the model when you switch via Pi's model picker |
| `autoloadOnMessage`  | boolean | `false` | Automatically load a model when you send a message   |

### Alternative: `llamaServerUrl`

For a simpler setup, you can use the `llamaServerUrl` key instead:

```json
{
  "llamaServerUrl": "http://127.0.0.1:8080"
}
```

This is equivalent to defining a single server in `llamaSettings.servers` with just a URL.

### Multiple Servers

To connect to multiple llama.cpp servers simultaneously:

**Using `llamaSettings` (recommended):**

```json
{
  "llamaSettings": {
    "servers": [
      { "url": "http://127.0.0.1:8080" },
      { "url": "http://127.0.0.1:8081" },
      { "url": "http://10.0.0.5:8080" }
    ]
  }
}
```

**Using `llamaServerUrl`:**

```bash
# Example with environment variable, but can be used for the rest of the options
LLAMA_SERVER_URL="http://127.0.0.1:8080;http://127.0.0.1:8081;http://10.0.0.5:8080"
```

Each server gets its own provider (e.g., **Llama.cpp (http://127.0.0.1:8080)**) and its own set of models. The `/models` command lists all models from all servers, labeled with their server URL.

### API Key

If your llama.cpp server requires authentication, use `/login` in Pi, select the "API key" option, and choose the provider from the list that correlates with the server needing the API key.

Alternatively, configure the API key in `~/.pi/agent/auth.json`:
Use the provider ID `llama-server=<url>`:

```json
{
  "llama-server=http://127.0.0.1:8080": {
    "type": "api_key",
    "key": "<key-for-server-1>"
  },
  "llama-server=https://some-url-for-llama-cpp": {
    "type": "api_key",
    "key": "<key-for-server-2>"
  }
}
```

## Usage

### Prerequisites

Make sure your llama.cpp server is running with the appropriate flags.

- For multi-model support (model router), start the server with:

```bash
llama-server --models-preset path/to/presets.ini ...
```

- For single-model mode, start the server with:

```bash
llama-server --model path/to/model.gguf ...
```

- For legacy-model mode (e.g., [ik_llama.cpp](https://github.com/ikawrakow/ik_llama.cpp)), the extension auto-detects and handles it transparently.

> **Note:** This extension is focused on llama.cpp, not on ik_llama.cpp. Nonetheless, since I found a way to make it work with this extension, I added the option.

> **Note:** The ik_llama.cpp fork is not legacy at all, but it uses an old way of describing models compared to llama.cpp.

The extension determines the context size as follows:

- **Router mode**
  - When loaded, reads `meta.n_ctx` from the `/v1/models` endpoint
  - When not loaded, reads `--ctx-size` and/or `--fit-ctx` from the server arguments (which can also originate from the **presets.ini** file the llama.cpp server uses to load its models).
- **Single mode** — reads `meta.n_ctx` from the `/v1/models` endpoint
- **Legacy mode** — reads `max_model_len` from `/v1/models`, falling back to `n_ctx` from `/props`
- Falls back to `128000` if not available

### Commands

| Command          | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `/models`        | Browse your models with live status. Select a model to load, switch, or unload it. |
| `/models info`   | Show detailed information for all available models at once.                        |
| `/models unload` | Unload all loaded models at once.                                                  |

> **Note:** When a llama.cpp server is slow to respond, it will be skipped at startup with a warning. Run `/models` to retry without timeout and see all models.

> **Note:** When a llama.cpp server is unreachable, `/models` displays an error notification with the configured server URL, but healthy servers continue to show their models.

> **Note:** The `/models unload` command only makes sense in router mode.

### Model Actions

When browsing models via the `/models` command, you can:

- **Load & switch** — Load an unloaded model and switch to it
- **Switch model** — Switch to a model that is already loaded
- **Unload** — Unload a loaded model to free memory
- **Retry** — Retry loading a failed model
- **Info** — View model details (ID, capabilities, context size)
- **Cancel** — Cancel the current operation

> **Note:** In single-model and legacy-model mode, **Unload** is not available, since there is only one model on the server.

### Thinking Budgets

The extension supports configurable **thinking budgets** that control how many tokens the model allocates to its reasoning/thinking process.
This is tied to Pi's thinking level selector (off, minimal, low, medium, high, xhigh, max).

| Level     | Tokens | Description                  |
| --------- | ------ | ---------------------------- |
| `off`     | 0      | Thinking disabled            |
| `minimal` | 1,024  | Short reasoning steps        |
| `low`     | 2,048  | Light reasoning              |
| `medium`  | 8,192  | Balanced reasoning (default) |
| `high`    | 16,384 | Extended reasoning           |
| `xhigh`   | 32,768 | Deep reasoning               |
| `max`     | -1     | Unlimited reasoning          |

User-defined budgets can override the defaults by adding a `thinkingBudgets` object to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (per-project):

```json
{
  "thinkingBudgets": {
    "minimal": 256,
    "low": 1024,
    "medium": 2048,
    "high": 4096,
    "xhigh": 8192
  }
}
```

Only `minimal`, `low`, `medium`, `high` and `xhigh` are configurable — `off` (0) and `max` (-1, unlimited) are fixed.
The extension automatically injects the appropriate `thinking_budget_tokens` into each request payload based on the selected level.

### Model Selection Event

When you switch models via Pi's model picker (instead of using the `/models` command), the extension listens for the `model_select` event, which also loads the requested model before the conversation begins.

This keeps the server in sync with the active model in Pi, regardless of how the switch was initiated — you don't need to manually load models before using them.

> **Note:** If you switch sessions while a model load is in-flight, you'll see a warning, but the load continues in the background. Use `/models` in the new session to verify the model status.

### Loading Models

When you trigger a load, switch, or retry action, the extension uses SSE (Server-Sent Events) to receive real-time progress updates from the server. If SSE is not available, it falls back to polling.

If loading takes longer than **60 seconds**, the operation times out with an error.

> **Note:** The timeout only applies to the progress detection. The model might still be loading in the background.

### Model Configuration

Each model exposed to Pi includes the following defaults:

- **`maxTokens`** — dynamically set to the model's context window (detected from llama-server)
- **`reasoning`** — `true` (assumed, as llama.cpp's `/v1/models` endpoint does not expose it)
- **`cost`** — all zero (local models)

## Dependencies

| Peer dependency                   | Purpose             |
| --------------------------------- | ------------------- |
| `@earendil-works/pi-ai`           | Pi AI SDK           |
| `@earendil-works/pi-coding-agent` | Pi Coding Agent SDK |
| `@earendil-works/pi-tui`          | Pi TUI SDK          |
