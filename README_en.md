<p align="center">
  <img src="resources/logo.png" alt="Open Cowork Logo" width="200" />
</p>

<h1 align="center">Open Cowork — Fork EE</h1>

<p align="center">
  Personal fork of <a href="https://github.com/OpenCoworkAI/open-cowork">Open Cowork</a> by <a href="https://github.com/Emilien-Etadam">Emilien-Etadam</a>
</p>

<p align="center">
  <a href="./readme.md">Français</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-3.3.1--EE4.94-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## What is it?

**Open Cowork** is a desktop AI agent app (Electron) for Windows and macOS. It manages your files, generates documents via **Skills** (PPTX, DOCX, XLSX, PDF), installs extensions through a curated **marketplace** (Skills, MCP, plugins), and isolates commands in a **sandbox** (WSL2 / Lima).

> [!NOTE]
> This repository is a **personal fork**. `EE*` releases are experimental **alpha** builds. For the official stable version, see [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## What this fork adds

- **12 languages** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — with backend localization (errors, dialogs)
- **Unified marketplace** — Settings → Extensions: skills, MCP connectors, and plugins (curated catalog, 21+ entries)
- **Slash commands** — `/` autocomplete in chat, including commands from installed plugins
- **Windows auto-update** — automatic updates from this fork's [GitHub releases](https://github.com/emilien-etadam/open-cowork/releases)
- **VS Code theme** — alternative to the default Claude theme (Settings → Appearance)
- **Copy / paste** — context menu and native shortcuts on Windows
- **Sandbox toggle** — enable/disable in Settings → Sandbox
- **pi-coding-agent 0.73.1** — recent agent + context compaction fixes

---

## Installation

### Releases (recommended)

Download the latest build from [Releases](https://github.com/emilien-etadam/open-cowork/releases):

| Platform              | File   |
| --------------------- | ------ |
| Windows               | `.exe` |
| macOS (Apple Silicon) | `.dmg` |

On **Windows**, the app checks for EE updates on startup and installs them on quit.

### From source

```bash
git clone https://github.com/emilien-etadam/open-cowork.git
cd open-cowork
npm install   # Node.js 22+
npm run dev
```

To build a local installer: `npm run build`

---

## Quick start

1. Open the app and go to **Settings** (⚙️ icon, bottom left).
2. Paste your **API key** and set the **base URL** for your provider (OpenRouter, Anthropic, GLM, MiniMax, Kimi…).
3. Install extensions in **Settings → Extensions** (MCP, skills, plugins).
4. Choose a **workspace folder** — the agent will only work inside that directory.
5. Send a prompt or type `/` for slash commands.

For more details (sandbox, MCP, changelog), see [`CHANGELOG.md`](CHANGELOG.md) and the [upstream README](https://github.com/OpenCoworkAI/open-cowork/blob/main/readme.md).

---

## License & credits

MIT — based on [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) by the upstream team.

Maintained by [Emilien-Etadam](https://github.com/Emilien-Etadam).
