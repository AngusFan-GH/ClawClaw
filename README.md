<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawClaw Logo" />
</p>

<h1 align="center">ClawClaw</h1>

<p align="center">
  <strong>The Desktop Interface for OpenClaw AI Agents</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#why-clawclaw">Why ClawClaw</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/Xzinfra/ClawClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja-JP.md">日本語</a>
</p>

---

## Overview

**ClawClaw** bridges the gap between powerful AI agents and everyday users. Built on top of [OpenClaw](https://github.com/OpenClaw), it transforms command-line AI orchestration into an accessible, beautiful desktop experience—no terminal required.

Whether you're automating workflows, managing AI-powered channels, or scheduling intelligent tasks, ClawClaw provides the interface you need to harness AI agents effectively.

ClawClaw supports mainstream cloud providers, OpenClaw-aligned local/self-hosted runtimes like Ollama, vLLM, and SGLang, plus multi-language settings out of the box. Of course, you can also fine-tune advanced configurations via **Settings → Advanced → Developer Mode**.

---

## Screenshot

<p align="center">
  <img src="resources/screenshot/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/cron_task.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/skills.png" style="width: 100%; height: auto;">
</p>

<!-- <p align="center">
  <img src="resources/screenshot/channels.png" style="width: 100%; height: auto;">
</p> -->

<p align="center">
  <img src="resources/screenshot/dashboard.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/settings.png" style="width: 100%; height: auto;">
</p>

---

## Why ClawClaw

Building AI agents shouldn't require mastering the command line. ClawClaw was designed with a simple philosophy: **powerful technology deserves an interface that respects your time.**

| Challenge                 | ClawClaw Solution                               |
| ------------------------- | ----------------------------------------------- |
| Complex CLI setup         | Guided first-launch setup with automatic runtime checks |
| Configuration files       | Visual settings with real-time validation       |
| Process management        | Automatic gateway lifecycle management          |
| Multiple AI providers     | Cloud provider panel plus local model center    |
| Skill/plugin installation | Built-in skill marketplace and management       |

### OpenClaw Inside

ClawClaw is built directly upon the official **OpenClaw** core. Instead of requiring a separate installation, we embed the runtime within the application to provide a seamless "battery-included" experience.

We are committed to maintaining strict alignment with the upstream OpenClaw project, ensuring that you always have access to the latest capabilities, stability improvements, and ecosystem compatibility provided by the official releases.
The bundled stable runtime is now aligned to **OpenClaw 2026.4.15**, which keeps ClawClaw on the current upstream stable release track while preserving the packaged desktop integration.

---

## Features

### 🎯 Zero Configuration Barrier

Complete the core setup through a guided first-launch flow. ClawClaw checks the runtime, starts the Gateway, installs the default skills, and then walks you to manual model configuration when you are ready.

### 💬 Intelligent Chat Interface

Communicate with AI agents through a modern chat experience. Support for multiple conversation contexts, message history, and rich content rendering with Markdown.

### 📡 Multi-Channel Management

Configure and monitor multiple AI channels simultaneously. Each channel operates independently, allowing you to run specialized agents for different tasks.
Channels now follow OpenClaw's type-first model: each channel type is shown as a single card with nested accounts, while account-level configuration, deletion, and status inspection stay aligned with the upstream runtime snapshot. Whether a channel exposes “Add account” depends on the upstream plugin's real multi-account capability, not on a blanket UI rule across all channel types. The intended flow is now explicit: create or edit concrete channel accounts on the Connections page first, then bind those accounts to agents on the Agents page so multi-account channels do not have to share one owner.
For WeChat, ClawClaw now treats login as a plugin-managed QR session: it prefers the bundled OpenClaw plugin mirror from the Connections page, falls back to the official install flow only when needed, requests a QR code directly in-app, refreshes expired sessions, and saves the returned account automatically. Model, agent, and connection configuration changes are now saved first and then applied through a shared pending-changes banner, so multi-step setup usually results in one Gateway reload or short restart instead of several.

### ⏰ Cron-Based Automation

Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock without manual intervention.

### 🧩 Extensible Skill System

Extend your AI agents with pre-built skills. Browse, install, and manage skills through the integrated skill panel—no package managers required.

### 🔐 Secure Provider Integration

Connect to multiple AI providers (OpenAI, Anthropic, OpenCode Go, and more) with API keys or supported OAuth flows. OpenAI Codex sign-in follows OpenClaw's native browser OAuth flow and now prefers newer upstream Codex models such as `gpt-5.4-pro` when that model is actually available, while keeping existing accounts on their saved model until you change them. Other provider accounts now prefer verified model lists resolved from the upstream endpoint when available, while still allowing manual model IDs if a provider cannot enumerate models. Model-type filters are shown only when the upstream source explicitly returns category metadata; otherwise the picker falls back to search-only, with no heuristic guessing in the UI. Self-hosted OpenAI-compatible runtimes such as Ollama, vLLM, and SGLang remain available as first-class providers, and each self-hosted account can now explicitly allow private-network endpoints when your OpenClaw request path must reach LAN or localhost services. The dedicated local-model center continues to handle the project-specific local model workflow. Credentials are stored securely in your system's native keychain.

> vLLM note: ClawClaw defaults vLLM models to `supportsTools: false` to avoid the common `400 "auto" tool choice` server error. You can now enable vLLM tool calling explicitly in provider settings, but your vLLM server must be started with `--enable-auto-tool-choice` and `--tool-call-parser`.

### 🛡️ Granular Security Policy

Configure denied directories and capability-level runtime restrictions separately. Reminders and denied-directory rules are synced into the agent workspace `AGENTS.md` as standing orders that continue to apply in new and existing conversations, while behavior restrictions map to OpenClaw's tool deny layer without overwriting unrelated deny rules already present in `openclaw.json`.

### 💻 Flexible Model Setup

ClawClaw no longer forces a bundled model during first launch. After the runtime is ready, you can open **Models** to add a local endpoint or a cloud provider, pick the model you want, or skip that step and finish it later. The cloud and self-hosted provider flows now stay closer to OpenClaw's provider-first onboarding, while the dedicated local-model center continues to preserve the existing local model workflow. Clearing the local-model provider now also removes any local models that depended on that provider, so stale local-model entries do not linger after the provider config is removed manually or from the UI. Saved model edits appear as pending runtime changes until you apply them, which keeps provider setup responsive and reduces unnecessary Gateway restarts.

### 🌙 Adaptive Theming

Light mode, dark mode, or system-synchronized themes. ClawClaw adapts to your preferences automatically.

---

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 1GB available disk space

### Installation

#### Pre-built Releases (Recommended)

Download the latest release for your platform from the [Releases](https://github.com/Xzinfra/ClawClaw/releases) page.

#### Build from Source

```bash
# Clone the repository
git clone https://github.com/Xzinfra/ClawClaw.git
cd ClawClaw

# Initialize the project
pnpm run init

# Start in development mode
# This also refreshes managed OpenClaw plugin mirrors needed by dev startup.
pnpm dev
```

### First Launch

When you launch ClawClaw for the first time, the **startup flow** keeps the welcome shell visible on every step and then runs:

1. automatic runtime checks
2. automatic Gateway startup
3. automatic installation of the default skills
4. an optional model-configuration step

Windows builds ship a bundled Python 3.12 runtime and use `UV_PYTHON` to point OpenClaw/uv at that executable, so first launch no longer downloads Python on the user's machine. If a developer build is missing that runtime, the setup code can still fall back to `uv python install` with official/mirror retries.

Model configuration is now manual. You can jump to **Models** from setup to add a local model or a cloud provider, or skip that step and finish it later.

### Bundled Project Skills

ClawClaw also preinstalls any project-local skill placed under `resources/skills/<slug>/SKILL.md`.
On startup, those directories are copied into the managed OpenClaw skills directory if they are not already installed.

Minimal example:

```text
resources/
  skills/
    my-skill/
      SKILL.md
```

See [resources/skills/README.md](resources/skills/README.md) for the expected layout and a starter `SKILL.md` template.

> Note for Moonshot (Kimi): ClawClaw keeps Kimi web search enabled by default.  
> When Moonshot is configured, ClawClaw also syncs Kimi web search to the China endpoint (`https://api.moonshot.cn/v1`) in OpenClaw config.

### Proxy Settings

ClawClaw includes built-in proxy settings for environments where Electron, the OpenClaw Gateway, or channels such as Telegram need to reach the internet through a local proxy client.

Open **Settings → Gateway → Proxy** and configure:

- **Proxy Server**: the default proxy for all requests
- **Bypass Rules**: hosts that should connect directly, separated by semicolons, commas, or new lines
- In **Developer Mode**, you can optionally override:
  - **HTTP Proxy**
  - **HTTPS Proxy**
  - **ALL_PROXY / SOCKS**

Recommended local examples:

```text
Proxy Server: http://127.0.0.1:7890
```

Notes:

- A bare `host:port` value is treated as HTTP.
- If advanced proxy fields are left empty, ClawClaw falls back to `Proxy Server`.
- Saving proxy settings reapplies Electron networking immediately and still restarts the Gateway automatically when required.
- Model, agent, and connection edits are saved as pending runtime changes and can be applied together, so repeated setup steps no longer trigger multiple Gateway restarts in a row.
- In `Follow System` mode, ClawClaw also resolves the OS proxy and passes it to the auto-started OpenClaw Gateway process.
- ClawClaw also syncs the proxy to OpenClaw's Telegram channel config when Telegram is enabled.

### Memory Settings

Open **Settings → Memory** to control how ClawClaw and OpenClaw preserve and recall information across sessions:

- **Auto-archive session memory** enables OpenClaw's bundled `session-memory` hook. On `/new` or `/reset`, OpenClaw writes a memory summary for the finished conversation into the workspace `memory/` folder.
- **Enable memory search** enables OpenClaw's `memorySearch` runtime configuration so later conversations can recall `MEMORY.md` and `memory/*.md` through the upstream `memory_search` and `memory_get` tools.
- **Lean local model runtime** enables OpenClaw's `agents.defaults.experimental.localModelLean` switch so local-model execution paths can prefer the lighter upstream runtime mode.

Notes:

- The current conversation still relies on the normal OpenClaw session transcript. `session-memory` is an additional cross-session archive, not the primary source of in-session context.
- Changing either memory toggle updates the managed OpenClaw config and restarts the Gateway automatically so the upstream runtime picks up the new setting.
- Model, agent, and connection edits now use a shared pending-apply flow; memory toggles still apply immediately because they affect active runtime behavior.

### Settings Backup and Cleanup

Open **Settings → Data & Uninstall** to export a JSON backup of your current configuration before removing data or uninstalling the app. The same section can stop the Gateway, clean managed ClawClaw/OpenClaw data from a fixed allowlist, and prepare a full uninstall flow before you remove the app itself from the OS uninstaller. On Windows, ClawClaw's own cache, storage, and logs are queued for post-exit cleanup so locked Chromium files can be removed safely after the app quits.

Open **Settings → Updates** to control auto-check / auto-download behavior and manually trigger update checks from the packaged app. ClawClaw currently follows the stable release feed only.
Windows packaging now stages an unpacked app payload plus the new ClawClaw Windows installer UI and installer-core manifest under `release/windows-installer`. Old NSIS installations are treated as migration inputs: the new plan imports the old install location, stops old ClawClaw/Gateway processes, removes stale runtime layouts, and preserves user data by default.
On the first launch after upgrading from an older ClawClaw or bundled OpenClaw version, ClawClaw now runs a one-time maintenance pass before normal Gateway startup and before any automatic update re-check so legacy provider records, managed plugin mirrors, and older `openclaw.json` shapes are repaired proactively instead of waiting for a startup failure.
Windows installed-build upgrades from `0.1.15` and earlier also trigger an expanded compatibility path: the installer core clears legacy bundled runtime and CLI directories before copying new files, and the first launch forces a heavier OpenClaw repair pass for older plugin, channel, and runtime layouts.
In **Settings → Developer**, the diagnostics section can run OpenClaw checks or repair with a compact status summary, while raw command output stays collapsed by default. The same section also exposes the OpenClaw Control UI entry when the Gateway is running.

---

## Architecture

ClawClaw employs a **dual-process architecture** with a unified host API layer. The renderer talks to a single client abstraction, while Electron Main owns protocol selection and process lifecycle:

```┌─────────────────────────────────────────────────────────────────┐
│                        ClawClaw Desktop App                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron Main Process                          │  │
│  │  • Window & application lifecycle management               │  │
│  │  • Gateway process supervision                              │  │
│  │  • System integration (tray, notifications, keychain)       │  │
│  │  • Auto-update orchestration                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC (authoritative control plane)  │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React Renderer Process                         │  │
│  │  • Modern component-based UI (React 19)                     │  │
│  │  • State management with Zustand                            │  │
│  │  • Unified host-api/api-client calls                        │  │
│  │  • Rich Markdown rendering                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Main-owned Gateway lifecycle
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Host API & Main Process Proxies                  │
│                                                                  │
│  • hostapi:fetch (Main proxy, avoids CORS in dev/prod)          │
│  • Unified error mapping and request telemetry                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Gateway RPC via Electron Main
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                             │
│                                                                  │
│  • AI agent runtime and orchestration                           │
│  • Message channel management                                    │
│  • Skill/plugin execution environment                           │
│  • Provider abstraction layer                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, ensuring UI responsiveness even during heavy computation
- **Single Entry for Frontend Calls**: Renderer requests go through host-api/api-client; protocol details are hidden behind a stable interface
- **Main-Process Runtime Ownership**: Electron Main owns Gateway startup, recovery, and RPC execution
- **Graceful Recovery**: Built-in reconnect, timeout, and backoff logic handles transient failures automatically
- **Secure Storage**: API keys and sensitive data leverage the operating system's native secure storage mechanisms
- **CORS-Safe by Design**: Local HTTP access is proxied by Main, preventing renderer-side CORS issues

---

## Use Cases

### 🤖 Personal AI Assistant

Configure a general-purpose AI agent that can answer questions, draft emails, summarize documents, and help with everyday tasks—all from a clean desktop interface.

### 📊 Automated Monitoring

Set up scheduled agents to monitor news feeds, track prices, or watch for specific events. Results are delivered to your preferred notification channel.

### 💻 Developer Productivity

Integrate AI into your development workflow. Use agents to review code, generate documentation, or automate repetitive coding tasks.

### 🔄 Workflow Automation

Chain multiple skills together to create sophisticated automation pipelines. Process data, transform content, and trigger actions—all orchestrated visually.

---

## Development

### Prerequisites

- **Node.js**: 22+ (LTS recommended)
- **Package Manager**: pnpm 9+ (recommended) or npm

### Project Structure

```ClawClaw/
├── electron/                 # Electron Main Process
│   ├── api/                 # Main-side API router and handlers
│   │   └── routes/          # RPC/HTTP proxy route modules
│   ├── services/            # Provider, secrets and runtime services
│   │   ├── providers/       # Provider/account model sync logic
│   │   └── secrets/         # OS keychain and secret storage
│   ├── shared/              # Shared provider schemas/constants
│   │   └── providers/
│   ├── main/                # App entry, windows, IPC registration
│   ├── gateway/             # OpenClaw Gateway process manager
│   ├── preload/             # Secure IPC bridge
│   └── utils/               # Utilities (storage, auth, paths)
├── src/                      # React Renderer Process
│   ├── lib/                 # Unified frontend API + error model
│   ├── stores/              # Zustand stores (settings/chat/gateway)
│   ├── components/          # Reusable UI components
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # Localization resources
│   └── types/               # TypeScript type definitions
├── tests/
│   └── unit/                # Vitest unit/integration-like tests
├── resources/                # Static assets (icons/images)
└── scripts/                  # Build and utility scripts
```

### Available Commands

```bash
# Development
pnpm run init             # Install dependencies + download uv
pnpm run python:download:win # Download bundled Windows Python runtimes for packaging
pnpm dev                  # Start with hot reload

# Quality
pnpm lint                 # Run ESLint
pnpm typecheck            # TypeScript validation

# Testing
pnpm test                 # Run unit tests
pnpm run release:check    # Run the release gate (upgrade compatibility + recovery checks)

# Build & Package
pnpm run build:vite       # Build frontend only
pnpm run installer:win:prepare # Build the Windows installer UI, Electron shell, and runner
pnpm run installer:win:shell:pack # Package the Windows installer shell on Windows
pnpm run package:prepare  # Shared packaging prep (vite + bundled OpenClaw + cleaned builder output)
pnpm build                # Prepare production packaging assets
pnpm package:mac          # Package for macOS
pnpm package:win          # Build Windows payload + updater-compatible setup exe/latest.yml
pnpm run package:organize # Re-home staged artifacts under release/v<version>/windows|mac|linux|metadata
pnpm package:linux        # Package for Linux
pnpm run upload:update    # Upload release/v<version>/windows/latest.yml and referenced Windows update artifacts
```

Notes:

- `pnpm package:win` builds the Windows unpacked payload via `scripts/package-win.mjs`, then builds the new Windows installer UI and stages updater-compatible `ClawClaw-Setup-v<version>-<arch>.exe` files plus `latest.yml`. It verifies or downloads the Windows `node.exe`, `uv.exe`, and Python runtime before invoking electron-builder.
- `pnpm run installer:win:prepare` validates the new Windows installer independently from the main app packaging flow.
- `pnpm package:prepare` is the shared pre-packaging step used by `build` and all platform package commands. It only cleans root-level builder staging output and leaves existing versioned release directories untouched.
- `pnpm package:organize` moves root-level builder output into `release/v<package.json version>/windows`, `release/v<package.json version>/mac`, `release/v<package.json version>/linux`, and `release/v<package.json version>/metadata`.
- `release/` now uses versioned directories. Existing versions are preserved; only artifacts inside the same version directory are replaced. The updater uploader reads from `release/v<package.json version>/windows/latest.yml`.
- `pnpm run upload:update` is intentionally kept as the Windows installed-build uploader. It preserves the legacy `latest.yml` contract for older installed versions and fails if `latest.yml` does not match `package.json`'s version.
- Bundled OpenClaw plugin mirrors are copied during `after-pack`, so packaging does not require a separate `bundle:openclaw-plugins` step.

### Release Gate

Before packaging a customer-facing release, run `pnpm run release:check`.

This gate focuses on upgrade stability rather than generic feature coverage. It verifies:

- legacy provider-store migration
- runtime provider/auth reconciliation before first Gateway launch
- malformed `openclaw.json` recovery with backup preservation
- bundled plugin mirror repair when the installed target is incomplete
- multi-agent runtime auth convergence during upgrade

### Tech Stack

| Layer        | Technology               |
| ------------ | ------------------------ |
| Runtime      | Electron 40+             |
| UI Framework | React 19 + TypeScript    |
| Styling      | Tailwind CSS + shadcn/ui |
| State        | Zustand                  |
| Build        | Vite + electron-builder  |
| Testing      | Vitest + Playwright      |
| Animation    | Framer Motion            |
| Icons        | Lucide React             |

---

## Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or translations—every contribution helps make ClawClaw better.

### How to Contribute

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes with clear messages
4. **Push** to your branch
5. **Open** a Pull Request

### Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

---

## Acknowledgments

ClawClaw is built on the shoulders of excellent open-source projects:

- [OpenClaw](https://github.com/OpenClaw) – The AI agent runtime
- [Electron](https://www.electronjs.org/) – Cross-platform desktop framework
- [React](https://react.dev/) – UI component library
- [shadcn/ui](https://ui.shadcn.com/) – Beautifully designed components
- [Zustand](https://github.com/pmndrs/zustand) – Lightweight state management

---

## Community

Join our community to connect with other users, get support, and share your experiences.

|                                Enterprise WeChat                                 |                                   Feishu Group                                    |                                         Discord                                          |
| :------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QR Code" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QR Code" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QR Code" /> |

### ClawClaw Partner Program 🚀

We're launching the ClawClaw Partner Program and looking for partners who can help introduce ClawClaw to more clients, especially those with custom AI agent or automation needs.

Partners help connect us with potential users and projects, while the ClawClaw team provides full technical support, customization, and integration.

If you work with clients interested in AI tools or automation, we'd love to collaborate.

DM us or email [public@xzinfra.com](mailto:public@xzinfra.com) to learn more.

---

## Star History

<p align="center">
  <img src="https://api.star-history.com/svg?repos=Xzinfra/ClawClaw&type=Date" alt="Star History Chart" />
</p>

---

## License

ClawClaw is released under the [MIT License](LICENSE). You're free to use, modify, and distribute this software.

---

<p align="center">
  <sub>Built with ❤️ by the Xzinfra Team</sub>
</p>
