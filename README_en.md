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
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-5.0.0-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## What is it?

**Lygodactylus** is a desktop AI agent app (Electron) for Windows and macOS. It manages your files, generates documents via **Skills** (PPTX, DOCX, XLSX, PDF), installs extensions through a curated **marketplace** (Skills, MCP, plugins), isolates commands in a **sandbox** (WSL2 / Lima), and offers **LAN chat** (a local web UI on your network).

> [!NOTE]
> This repository is a **personal fork**. `EE*` releases are experimental **alpha** builds. For the official stable version, see [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## What this fork adds

- **12 languages** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — with backend localization (errors, dialogs)
- **Unified marketplace** — Settings → Extensions: skills, MCP connectors, and plugins (curated catalog, 21+ entries)
- **LAN chat** — local web server to talk to the agent from a browser (Settings → Chat LAN)
- **Slash commands** — `/` autocomplete in chat, including commands from installed plugins
- **Message fork / edit** — start a new session from a message or edit a user prompt
- **Proactive compaction** — auto-compact when context is nearly full
- **EE updates** — Windows auto-update + “Check for updates” button (Settings → General)
- **Simplified API config** — two profiles: OpenAI-compatible and Anthropic-compatible
- **VS Code theme**, **copy/paste** on Windows, **sandbox toggle**, **pi-coding-agent 0.73.1**

---

## Installation

### Releases (recommended)

Download the latest build from [Releases](https://github.com/emilien-etadam/lygodactylus/releases):

| Platform              | File   |
| --------------------- | ------ |
| Windows               | `.exe` |
| macOS (Apple Silicon) | `.dmg` |

On **Windows**, the app checks for EE updates on startup. Otherwise use **Settings → General → Check for updates**.

### From source

```bash
git clone https://github.com/emilien-etadam/lygodactylus.git
cd lygodactylus
npm install   # Node.js 22+
npm run dev
```

To build a local installer: `npm run build`

---

## Quick start

1. Open the app and go to **Settings** (⚙️ icon, bottom left).
2. Set up an **OpenAI-compatible** or **Anthropic-compatible** provider (API key + base URL).
3. Install extensions in **Settings → Extensions** (MCP, skills, plugins).
4. Choose a **workspace folder** — the agent will only work inside that directory.
5. Send a prompt, type `/` for slash commands, or enable **LAN chat** to use the browser UI.

For release details, see [`CHANGELOG.md`](CHANGELOG.md).

---

## License & credits

MIT — based on [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) by the upstream team.

Maintained by [Emilien-Etadam](https://github.com/Emilien-Etadam).
