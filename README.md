# pi-llama-cpp

A [Pi Coding Agent](https://pi.dev/) extension that connects to multiple [llama.cpp servers](https://github.com/ggml-org/llama.cpp) — router, single, legacy, or llama-swap — and manages their models directly from Pi.

## Features

- **Auto-detect models** — discovers all models across all connected servers
- **Multiple server support** — connect to multiple llama.cpp servers simultaneously via `llamaSettings.servers` or semicolon-separated URLs
- **Live status indicators** — see which models are loaded, loading, failed, sleeping, or unloaded with color-coded icons
- **Load / unload / switch** — manage models directly from the Pi command palette
- **Server mode support** — works with router, single, legacy, and llama-swap server configurations
- **Image capabilities detection** — detects multimodal models automatically
- **Flexible configuration** — via `llamaSettings`, environment variable, or legacy `llamaServerUrl`
- **Auth support** — login into servers secured with an API key
- **Llama-swap support** — auto-detects and provides integration with [llama-swap](https://github.com/mostlygeek/llama-swap) gateways
- **Thinking budget support** — configurable token budgets for model reasoning/thinking, mapped to Pi's thinking levels
- **Real-time progress tracking** — live loading progress via SSE (falls back to polling)

## Installation

This package is a Pi extension. Install it with

```bash
pi install npm:pi-llama-cpp
```

or

```bash
pi install https://github.com/gsanhueza/pi-llama-cpp
```

## Status Indicators

| Icon | Status    | Description                       |
| ---- | --------- | --------------------------------- |
| 🟢   | Loaded    | Model is active and ready to use  |
| 🟡   | Loading   | Model is currently being loaded   |
| 🔴   | Failed    | Model failed to load              |
| 🔵   | Sleeping  | Model is available, but inactive  |
| ⚪   | Unloaded  | Model is not loaded on the server |
| 🟣   | Unmanaged | Model is remote peer (llama-swap) |

> **Note**: The `Sleeping` status only shows when you start your server with `llama-server --sleep-idle-seconds <n> ...`.
> This is a **llama.cpp server flag** that tells the server to put idle models to sleep after `n` seconds.
> The model awakens automatically when you send a message.

## Server Health Indicators

When browsing servers via `/models servers`, each server URL is prefixed with a health indicator:

| Icon | Status       | Description                                   |
| ---- | ------------ | --------------------------------------------- |
| 🟢   | Healthy      | Server responded successfully to health check |
| 🟡   | Timeout      | Server health check timed out                 |
| 🔴   | Unreachable  | Server could not be reached                   |
| ⛔   | Unauthorized | Server requires an API key                    |

When a server is slow or unreachable it's skipped at startup with a warning; run `/models` to retry without timeout. `/models` also shows an error notification for unreachable servers while healthy ones keep showing their models.

> **Note:** You can run your server with API authentication with `llama-server --api-key <your key> ...`.

## Server Modes

The extension supports the following server configurations. It auto-detects the mode from the server's response.

### Router mode

Use this when your server runs multiple models via `--models-preset`. This is the default and most feature-rich mode.

- **Setup:** `llama-server --models-preset path/to/presets.ini ...`
- **Context size:** When loaded, reads `meta.n_ctx` from `/v1/models`; when not loaded, reads `--ctx-size` and/or `--fit-ctx` from server arguments (or presets.ini)
- **Features:** Full model lifecycle management — load, unload, switch
- **`/models unload`:** Available (unloads all loaded models)

### Single mode

Use this when your server runs a single model via `--model`.

- **Setup:** `llama-server --model path/to/model.gguf ...`
- **Context size:** Reads `meta.n_ctx` from `/v1/models`
- **Features:** Load and switch only — unload is not available (only one model on the server)

### Legacy mode

Use this for servers similar to [ik_llama.cpp](https://github.com/ikawrakow/ik_llama.cpp). The extension auto-detects and handles it transparently.

- **Setup:** `llama-server --model path/to/model.gguf ...`
- **Context size**: Reads `max_model_len` from `/v1/models`, falling back to `n_ctx` from `/props`
- **Features:** Load and switch only — unload is not available (only one model on the server)

### Llama-swap mode

Use this when pointing at a running [llama-swap](https://github.com/mostlygeek/llama-swap) instance instead of a raw llama.cpp server. The extension auto-detects this mode via the `src` field in the server props response.

- **Setup:** `llama-swap -config path/to/llama-swap.yaml --listen <host>:<port> ...`
- **Context size:** Reads `meta.n_ctx` from the llama-swap server via `/v1/models`. Falls back to the override or the default (128,000 tokens) for peer models, since llama-swap does not expose peer model metadata. Add a `contextSize` override if you need a specific value.
- **Features:** Load/unload for local models, switch for peer models
- **Peer models:** Remote models from other llama-swap instances or bare llama.cpp servers. They show with a 🟣 (unmanaged) status and only support **Switch** (no load/unload), since llama-swap does not manage their lifecycle and does not expose a way to control it.

## Configuration

The extension resolves the llama.cpp server configuration using the following priority order:

1. **Environment variable** — `LLAMA_SERVER_URL`
2. **`llamaSettings`** — Main configuration format in `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global)
3. **`llamaServerUrl`** — Legacy format in `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global)
4. **Default** — `http://127.0.0.1:9931`

### Server configuration

The recommended way to configure the extension is using the `llamaSettings` key. This provides a structured way to define multiple servers with custom names and IDs, plus additional behavior options.

Add this to your `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

#### Minimal configuration

```json
{
  "llamaSettings": {
    "servers": [{ "url": "http://127.0.0.1:9931" }]
  }
}
```

#### Full configuration

```json
{
  "llamaSettings": {
    "servers": [
      {
        "url": "http://127.0.0.1:9931",
        "id": "local",
        "name": "Local Server",
        "overrides": {}
      },
      {
        "url": "http://10.0.0.5:9931",
        "name": "Remote Server"
      }
    ],
    "reactToModelSelect": true,
    "autoloadOnMessage": true,
    "sortBy": "asc",
    "pollingInterval": 500,
    "pollingTimeout": 60000,
    "serverTimeout": 1000,
    "showServerUrls": true,
    "enableSSE": true
  }
}
```

With this config, the servers will appear in Pi as **Llama.cpp (Local Server)** and **Llama.cpp (Remote Server)**.

#### Server Options

| Option | Type   | Required | Description                                                                  |
| ------ | ------ | -------- | ---------------------------------------------------------------------------- |
| `url`  | string | Yes      | The URL of the llama.cpp server                                              |
| `id`   | string | No       | Custom provider ID (used for API key auth). Defaults to `llama-server=<url>` |
| `name` | string | No       | Display name for the server in the UI (shown as `Llama.cpp (<name>)`)        |

> **Note:** If you set a custom `id`, you can use it in `~/.pi/agent/auth.json`. The extension will also fall back to the URL-based ID if no key is found for the custom `id`.

#### Settings Options

| Option               | Type    | Default | Description                                                   |
| -------------------- | ------- | ------- | ------------------------------------------------------------- |
| `reactToModelSelect` | boolean | `true`  | Load the model when you switch via Pi's model picker.         |
| `autoloadOnMessage`  | boolean | `true`  | Automatically load an unloaded model before sending a message |
| `sortBy`             | string  | `"asc"` | Sort order for models (see below)                             |
| `pollingInterval`    | number  | `500`   | Time (ms) between status checks during model load/unload      |
| `pollingTimeout`     | number  | `60000` | Max time (ms) to wait for model loading before giving up      |
| `serverTimeout`      | number  | `1000`  | Timeout (ms) for server health checks and SSE probes          |
| `showServerUrls`     | boolean | `true`  | Show `[Server: <url>]` suffix in the /models model list       |
| `enableSSE`          | boolean | `true`  | Use SSE for model loading progress (falls back to polling)    |

> **Note:** `serverTimeout` controls individual HTTP request timeouts (health checks, SSE probe). `pollingTimeout` controls the total wait time for a model to finish loading. Increase `serverTimeout` for slow/high-latency servers, and `pollingTimeout` for large models or slow hardware.

#### In-session settings menu

Run `/models settings` to edit the scalar settings above without hand-editing JSON. Changes are written to the **project** `.pi/settings.json` if it exists, otherwise to **global** `~/.pi/agent/settings.json`. Boolean and sort changes apply immediately; timeout changes apply on the next model load. The `servers` list is edited with `/models servers` (see below), and per-server model overrides with `/models overrides` (see [Model Overrides](#model-overrides)). Press **r** on any setting to reset it to its default value.

#### Server list editor

Run `/models servers` to add, edit or remove entries of `llamaSettings.servers`
without hand-editing JSON. Each server URL is prefixed with a status indicator
(🟢 healthy, 🟡 timeout, 🔴 unreachable, ⛔ unauthorized) that reflects the
result of a health check and an auth probe against the server. Each change is
written immediately to the **project** `.pi/settings.json` if it exists,
otherwise to **global** `~/.pi/agent/settings.json`.

Changes take effect immediately after closing the editor: new servers
register their providers, removed ones leave pi's registry right away,
and edited ones are re-registered with the fresh config — no restart or
`/models` needed.

Limitation: a model already loading in the background on a removed or
edited server finishes loading, but its progress notifications stop;
re-select it from the (new) provider afterwards.

#### Environment variable

For a quick setup, you can use the `LLAMA_SERVER_URL` environment variable instead of the JSON config:

```bash
export LLAMA_SERVER_URL="http://127.0.0.1:9931"
```

This is equivalent to defining a single server in `llamaSettings.servers` with just a URL.

If the server requires authentication, also set `LLAMA_SERVER_API_KEY` to bypass the credential store.

```bash
export LLAMA_SERVER_API_KEY="sk-your-api-key"
```

### Legacy configuration

For a simpler setup, you can use the legacy `llamaServerUrl` key:

```json
{
  "llamaServerUrl": "http://127.0.0.1:9931"
}
```

This is equivalent to defining a single server in `llamaSettings.servers` with just a URL.

### Multiple servers

To connect to multiple llama.cpp servers simultaneously:

**Using `llamaSettings` (recommended):**

```json
{
  "llamaSettings": {
    "servers": [
      { "url": "http://127.0.0.1:9931" },
      { "url": "http://127.0.0.1:8081" },
      { "url": "http://10.0.0.5:9931" }
    ]
  }
}
```

**Using the environment variable:**

```bash
LLAMA_SERVER_URL="http://127.0.0.1:9931;http://127.0.0.1:8081;http://10.0.0.5:9931"
```

Each server gets its own provider (e.g., **Llama.cpp (http://127.0.0.1:9931)**) and its own set of models. The `/models` command lists all models from all servers, labeled with their server URL.

### API Key

If your llama.cpp server requires authentication, use `/login` in Pi, select the "API key" option, and choose the provider from the list that correlates with the server needing the API key.

Alternatively, configure the API key in `~/.pi/agent/auth.json`:
Use the provider ID `llama-server=<url>` (or your custom `id` if you set one in `llamaSettings.servers`).

The `key` field supports several formats:

| Format            | Example                                      | Description                                |
| ----------------- | -------------------------------------------- | ------------------------------------------ |
| **Literal**       | `"sk-abc123"`                                | API key stored directly                    |
| **Env ref**       | `"$OPENAI_API_KEY"` or `"${OPENAI_API_KEY}"` | Resolved from `process.env` or `env` field |
| **Shell command** | `"!cat ~/.secrets/llama-key"`                | Stdout of the command is used              |
| **Escape**        | `"$$literal"`                                | `$$` → literal `$`, `$!` → literal `!`     |

```json
{
  "llama-server=http://127.0.0.1:9931": {
    "type": "api_key",
    "key": "sk-abc123"
  },
  "llama-server=https://some-url-for-llama-cpp": {
    "type": "api_key",
    "key": "$LLAMA_API_KEY"
  },
  "llama-server=https://secure-server": {
    "type": "api_key",
    "key": "!cat ~/.secrets/llama-key"
  },
  "llama-server=https://braced-ref": {
    "type": "api_key",
    "key": "${API_KEY}"
  }
}
```

For env ref formats, you can also store the variable value alongside the key using the `env` field:

```json
{
  "llama-server=http://127.0.0.1:9931": {
    "type": "api_key",
    "key": "$MY_KEY",
    "env": {
      "MY_KEY": "sk-abc123"
    }
  }
}
```

## Usage

### Commands

| Command             | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `/models`           | Browse your models with live status. Select a model to load, switch, or unload it.      |
| `/models info`      | Show detailed information for all available models at once.                             |
| `/models unload`    | Unload all loaded models at once.                                                       |
| `/models reload`    | Reload all loaded and sleeping models (unload → load).                                  |
| `/models settings`  | Open a menu to edit the scalar `llamaSettings` fields.                                  |
| `/models servers`   | Add, edit or remove llama.cpp server URLs via a TUI editor.                             |
| `/models overrides` | Edit per-server model overrides (`llamaSettings.servers[].overrides`) via a TUI editor. |

#### Model sorting

The order of models in the `/models` menu is controlled by the `sortBy` setting.
Servers maintain their order from `llamaSettings`; sorting applies **within each server**:

| Value         | Description                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `"asc"`       | Sort by model ID ascending (default)                                                                                      |
| `"desc"`      | Sort by model ID descending                                                                                               |
| `"asc-name"`  | Sort by model name ascending (ties broken by ID)                                                                          |
| `"desc-name"` | Sort by model name descending (ties broken by ID)                                                                         |
| `"api"`       | No sorting — models appear in the order returned by each server's `/v1/models` endpoint, servers in `llamaSettings` order |

### Model Actions

When browsing models via the `/models` command, you can:

- **Load & switch** — Load an unloaded model and switch to it
- **Switch model** — Switch to a model that is already loaded
- **Unload** — Unload a loaded model to free memory
- **Reload** — Reload a loaded or sleeping model (unload → load)
- **Retry** — Retry loading a failed model
- **Info** — View model details (ID, capabilities, context size)
- **Cancel** — Cancel the current operation

> **Note:** Unload operations display progress notifications (similar to loading) so you can track the operation in real time.

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

### Model Overrides

A locally-run `llama.cpp` server is free, but you can simulate costs for budgeting, experimentation, or comparison purposes — and fine-tune what the extension reports about each model.

This extension supports **per-model, per-server configuration** via the `overrides` key inside each server entry of `llamaSettings.servers`. Each entry can override the model's `cost`, `capabilities`, `reasoning`, `contextSize`, `maxTokens`, and `compat`, regardless of what the server reports.

Add overrides to your server configuration:

```json
{
  "llamaSettings": {
    "servers": [
      {
        "url": "http://127.0.0.1:9931",
        "overrides": {
          "qwen-3.8-27b": {
            "cost": { "input": 0.42, "output": 3.0, "cacheRead": 0.085 }
          },
          "glm-5.3-flash": {
            "cost": { "input": 0.15, "output": 0.5, "cacheRead": 0.03 },
            "capabilities": ["text"],
            "reasoning": false,
            "contextSize": 32768,
            "maxTokens": 4096
          }
        }
      }
    ]
  }
}
```

Every field of an override is optional — absent fields fall back to what the extension detects (`capabilities`) or to its defaults (`reasoning: true`, zeroed cost).

#### Prefix matching

Override keys are treated as **prefix filters** — a model ID matches if it starts with the key. When multiple patterns match, the **longest (most specific) match wins**. This lets you define broad patterns at the top of your overrides and override them with more specific ones below.

Example:

```json
{
  "llama": { "cost": { "input": 0.01, "output": 0.02 } },
  "llama-3": { "reasoning": false },
  "llama-3-8b": { "cost": { "input": 0.2, "output": 0.6 } }
}
```

| Model ID      | Matching keys                    | Winner (longest) | Effective override                                     |
| ------------- | -------------------------------- | ---------------- | ------------------------------------------------------ |
| `llama-3-8b`  | `llama`, `llama-3`, `llama-3-8b` | `llama-3-8b`     | `{ cost: { input: 0.2, output: 0.6 } }`                |
| `llama-3-70b` | `llama`, `llama-3`               | `llama-3`        | `{ reasoning: false }`                                 |
| `mistral-7b`  | `llama` (no)                     | none             | defaults (zero cost, detected caps, `reasoning: true`) |

> **Note:** Exact model IDs still work — they are simply the longest possible prefix for themselves. Empty keys are silently ignored.

Model matching uses this prefix system — the model ID must start with the override key for a match.

> **Note:** Overrides are resolved through the same settings merge logic (project overrides global), so they follow the same precedence chain as other server settings. If the same URL appears multiple times with different `overrides`, only the first one's overrides will be used (consistent with existing dedup behavior).

#### Override editor

Run `/models overrides` to edit a server's override entries without hand-editing
JSON. It opens a settings menu (same UX as `/models settings`).

Each change is written immediately to the **project**
`.pi/settings.json` if it exists, otherwise to **global**
`~/.pi/agent/settings.json`.

Overrides take effect on the next provider request after closing the editor —
no `/reload` needed.

#### Cost Fields

Inside an override, the `cost` object accepts:

| Field        | Type   | Description                         |
| ------------ | ------ | ----------------------------------- |
| `input`      | number | Cost per million input tokens       |
| `output`     | number | Cost per million output tokens      |
| `cacheRead`  | number | Cost per million cache read tokens  |
| `cacheWrite` | number | Cost per million cache write tokens |

All four fields are optional — unspecified fields default to zero.
In the override editor, entering `0` (or leaving a field empty) removes the field from the settings — and the `cost` object itself once no fields remain — with the same effect as leaving it unset.

#### Other Fields

| Field                           | Type             | Description                                                                                      |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `capabilities`                  | array of strings | Pi capabilities for the model (`"text"`, `"image"`). Fully replaces the detected capabilities.   |
| `reasoning`                     | boolean          | Whether the model is a reasoning model. Defaults to `true` when absent.                          |
| `contextSize`                   | number           | Override the model's context size in tokens. Falls back to autodetection when absent or `0`.     |
| `maxTokens`                     | number           | Override max generation tokens. Falls back to context size when absent or `0`.                   |
| `compat`                        | object           | OpenAI-compatible provider compatibility settings (see below).                                   |
| `samplingParams`                | object           | Sampling parameters sent with every request (see below).                                         |
| `samplingParamsByThinkingLevel` | object           | Sampling parameters keyed by thinking level; merged with `samplingParams` per level (see below). |

#### Compatibility (`compat`)

The `compat` field accepts any subset of [OpenAI-compatible provider compatibility settings](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) used by the `openai-completions` API. These control how the extension talks to your server — for example, disabling `developer` role support, choosing the thinking format, enabling Anthropic-style cache control, or setting thinking token budgets.

Example:

```json
{
  "llamaSettings": {
    "servers": [
      {
        "url": "http://127.0.0.1:9931",
        "overrides": {
          "llama-3": {
            "compat": {
              "supportsDeveloperRole": false,
              "thinkingFormat": "openai",
              "thinkingTokenBudgetField": "thinking_budget_tokens"
            }
          }
        }
      }
    ]
  }
}
```

#### Sampling Parameters (`samplingParams`)

Sampling parameters control text generation behavior (for more information, see [Pi docs: Configure sampling by thinking level](https://pi.dev/docs/latest/models#configure-sampling-by-thinking-level)).

Set them via the TUI: `/models overrides` → select an entry → **samplingParams** → edit individual parameters.

| Parameter           | Type  | Description                                                                                                |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `temperature`       | float | Adjust the randomness of the generated text                                                                |
| `top_k`             | int   | Limit the next token selection to the K most probable tokens                                               |
| `top_p`             | float | Limit the next token selection to a subset of tokens with cumulative probability above threshold P         |
| `min_p`             | float | The minimum probability for a token to be considered, relative to the probability of the most likely token |
| `repeat_penalty`    | float | Control the repetition of token sequences in the generated text                                            |
| `presence_penalty`  | float | Repeat alpha presence penalty                                                                              |
| `frequency_penalty` | float | Repeat alpha frequency penalty                                                                             |
| `seed`              | int   | Random seed for reproducible sampling                                                                      |

The TUI exposes the parameters above. For more llama.cpp params not listed here (e.g. `mirostat`, `typical_p`, `xtc_probability`, `dry_multiplier`, `n_probs`, `grammar_lazy`, etc), add them directly in `samplingParams` in your `settings.json` — [llama.cpp](<(https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-completion-given-a-prompt-it-returns-the-predicted-completion)>) accepts them as-is.

To set them manually in JSON, add a `samplingParams` object inside the override:

```json
{
  "llamaSettings": {
    "servers": [
      {
        "url": "http://127.0.0.1:9931",
        "overrides": {
          "llama-3": {
            "samplingParams": {
              "temperature": 0.7,
              "top_p": 0.9,
              "repeat_penalty": 1.1
            }
          }
        }
      }
    ]
  }
}
```

##### Sampling Parameters by Thinking Level

The extension merges the base `samplingParams`, the effective level's override, and request-level params — later values win per key. Supported thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

> **Note:** `samplingParamsByThinkingLevel` is not exposed in the TUI override editor. Edit it manually in `settings.json`:
>
> ```json
> {
>   "llamaSettings": {
>     "servers": [
>       {
>         "url": "http://127.0.0.1:9931",
>         "overrides": {
>           "llama-3": {
>             "samplingParams": {
>               "temperature": 0.7
>             },
>             "samplingParamsByThinkingLevel": {
>               "minimal": { "temperature": 0.9 },
>               "high": { "temperature": 0.3 }
>             }
>           }
>         }
>       }
>     ]
>   }
> }
> ```

### Model Selection Event

When you switch models via Pi's model picker (instead of using the `/models` command), the extension listens for the `model_select` event, which also loads the requested model before the conversation begins.

This keeps the server in sync with the active model in Pi, regardless of how the switch was initiated — you don't need to manually load models before using them.

You can disable this behavior by setting `reactToModelSelect` to `false` in `llamaSettings`.

> **Note:** If you switch sessions while a model load is in-flight, you'll see a warning, but the load continues in the background. Use `/models` in the new session to verify the model status.

### Loading Models

When you trigger a load, switch, or retry action, the extension uses SSE (Server-Sent Events) to receive real-time progress updates from the server. If SSE is not available, it falls back to polling (every **500 ms**, configurable via `pollingInterval`).

If loading takes longer than **60 seconds** (configurable via `pollingTimeout`), the operation times out with an error.

> **Note:** The timeout only applies to the progress detection. The model might still be loading in the background.

### Model Configuration

Each model exposed to Pi includes the following defaults.

- **`contextWindow`** — detected from llama-server (see [Server Modes](#server-modes))
- **`maxTokens`** — dynamically set to the model's context window (detected from llama-server)
- **`reasoning`** — `true` by default (llama.cpp's `/v1/models` endpoint does not expose it)
- **`cost`** — all zero by default
- **`compat`** — OpenAI-compatible provider compatibility settings

These can be overridden per-model via `llamaSettings.servers[].overrides` (see [Model Overrides](#model-overrides)).

## Dependencies

| Peer dependency                   | Purpose             |
| --------------------------------- | ------------------- |
| `@earendil-works/pi-ai`           | Pi AI SDK           |
| `@earendil-works/pi-coding-agent` | Pi Coding Agent SDK |
| `@earendil-works/pi-tui`          | Pi TUI SDK          |
