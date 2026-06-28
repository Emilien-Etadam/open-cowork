<p align="center">
  <img src="resources/logo.png" alt="Lygodactylus Logo" width="200" />
</p>

<h1 align="center">Lygodactylus</h1>

<p align="center">
  Personal fork of <a href="https://github.com/OpenCoworkAI/open-cowork">Open Cowork</a> by <a href="https://github.com/Emilien-Etadam">Emilien-Etadam</a>
</p>

<p align="center">
  <a href="./readme.md">Français</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-5.8.1-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## What is it?

**Lygodactylus** is a desktop AI agent app (Electron) for Windows, macOS, and Linux. It manages your files, generates documents via **Skills** (bundled PDF/XLSX; DOCX/PPTX downloaded on first use), installs extensions through a curated **marketplace** (Skills, MCP, plugins), isolates commands in a **sandbox** (WSL2 / Lima), offers **LAN chat** (a web UI on your network — recommended over a WireGuard VPN tunnel), and ships **native tools** (glob, grep, web, todos, interactive questions) compatible with LiteLLM / vLLM / Qwen.

> [!NOTE]
> This repository is a **personal app-only fork** (no VitePress website or upstream bots). The **v5.x** series is an experimental **alpha**. Older `EE*` releases remain available but are no longer the active branch. For the official stable upstream version, see [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## What this fork adds

### Agent & models

- **12 languages** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — with backend localization (errors, dialogs)
- **Native tools (v5.7+)** — `glob`, `grep`, `web_fetch`, `web_search`, `http_request`, `todo_write`, `ask_user_question` (flat TypeBox schemas for LiteLLM → vLLM → Qwen)
- **AskUserQuestion** — interactive inline questions in chat (dedicated IPC)
- **Memory (v5.6+)** — “Used memory” panel, per-session toggle, unified ranker, configurable injection policy (`escape` / `strip-suspicious` / `block`)
- **Simplified API config** — two profiles: OpenAI-compatible and Anthropic-compatible
- **Automatic model detection** for remote API endpoints
- **Proactive compaction** — auto-compact when context is nearly full
- **Message fork / edit** — start a new session from a message or edit a user prompt
- **Slash commands** — `/` autocomplete in chat, including commands from installed plugins
- **VS Code theme**, **copy/paste** on Windows, **sandbox toggle**, **pi-coding-agent 0.80.2** (`@earendil-works`)

### Extensions & documents

- **Unified marketplace** — Settings → Extensions: skills, MCP connectors, and plugins (curated catalog, 21+ entries)
- **On-demand skills (v5.4+)** — `docx` and `pptx` (~2.7 MB) downloaded from GitHub Releases on first use; `pdf`, `xlsx`, `skill-creator` bundled
- **On-demand runtimes (v5.3+)** — Node.js, Python 3.10, and cliclick (macOS) downloaded into `userData` on first use (slimmer installer)

### Network & sandbox

- **LAN chat** — local web server to talk to the agent from a browser (Settings → Chat LAN; recommended over WireGuard VPN)
- **Sandbox LAN network (v5.8+)** — reach local network services from the sandbox without disabling it: authenticated host proxy (opt-in in Settings), RFC1918 filtering; `http_request` and `web_fetch` with custom headers via the host network stack

### Distribution

- **Updates** — Windows auto-update + “Check for updates” button (Settings → General)
- **Linux (v5.6+)** — x64 AppImage builds published on GitHub Releases

### Removed vs upstream / older EE builds

- **Feishu / remote control** — Feishu integration, WebSocket gateway, Slack, and ngrok tunnel removed (replaced by LAN chat)
- **VitePress website** — project website removed from the repo (v5.8); docs live in `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`
- **Upstream bots & governance** — Codex PR review bot and upstream CONTRIBUTING/CODEOWNERS templates removed (app-only repo)

---

## Installation

### Releases (recommended)

Download the latest build from [Releases](https://github.com/emilien-etadam/lygodactylus/releases):

| Platform              | File        |
| --------------------- | ----------- |
| Windows               | `.exe`      |
| macOS (Apple Silicon) | `.dmg`      |
| Linux (x64)           | `.AppImage` |

On **Windows**, the app checks for updates on startup. On **macOS/Linux**, use **Settings → General → Check for updates**.

> [!TIP]
> On first use, Node.js, Python, and heavy skills (`docx`/`pptx`) may be downloaded automatically from official GitHub releases.

### From source

```bash
git clone https://github.com/emilien-etadam/lygodactylus.git
cd lygodactylus
npm install   # Node.js 22.19+
npm run dev
```

To build a local installer:

| Platform | Command               |
| -------- | --------------------- |
| Windows  | `npm run build:win`   |
| Linux    | `npm run build:linux` |
| macOS    | `npm run build`       |

---

## Quick start

1. Open the app and go to **Settings** (⚙️ icon, bottom left).
2. Set up an **OpenAI-compatible** or **Anthropic-compatible** provider (API key + base URL).
3. Install extensions in **Settings → Extensions** (MCP, skills, plugins).
4. Choose a **workspace folder** — the agent will only work inside that directory.
5. Send a prompt, type `/` for slash commands, or enable **LAN chat** for the browser UI (preferably over a WireGuard tunnel).
6. To reach LAN services from the sandbox, enable **Settings → Sandbox → Sandbox LAN network access** (opt-in).

For release details, see [`CHANGELOG.md`](CHANGELOG.md).

---

## License & credits

MIT — based on [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) by the upstream team. See [`LICENSE`](LICENSE) and [`SECURITY.md`](SECURITY.md).

Maintained by [Emilien-Etadam](https://github.com/Emilien-Etadam).
