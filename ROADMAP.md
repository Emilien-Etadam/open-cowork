# 🗺️ Open Cowork Roadmap

> Development direction for the [Emilien-Etadam/open-cowork](https://github.com/Emilien-Etadam/open-cowork) fork (alpha series `3.3.1-EE*`).
> For feature requests and discussion, see [GitHub Issues](https://github.com/Emilien-Etadam/open-cowork/issues).

## ✅ Completed

### Upstream baseline (3.3.x)

- **Core**: Stable Windows & macOS installers with build verification
- **Security**: Full filesystem sandboxing + path traversal / zip-slip hardening
- **VM Sandbox**: WSL2 (Windows) and Lima (macOS) VM-level isolation
- **Skills**: PPTX, DOCX, PDF, XLSX support + custom skill management + hot-reload
- **MCP Connectors**: Custom connector support (stdio / SSE / Streamable HTTP)
- **Rich Input**: File upload and image input in chat
- **Multi-Model**: Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi, Grok, MiniMax, Ollama
- **UI/UX**: Enhanced interface with English/Chinese localization
- **Remote Control**: Feishu (Lark) bot integration with pairing mode + approval panel
- **CI/CD**: Automated builds, smoke tests, Codex-powered PR review bot
- **Model Presets**: Up-to-date model catalogs for all major providers
- **Dependency Policy**: Tiered management strategy with Dependabot grouping
- **Memory System Foundation**: Unified storage with core/experience memory and source-aware retrieval workflow

### EE fork (`3.3.1-EE1` → `3.3.1-EE4.2`)

- **EE4**: Slash command autocomplete, `README_en.md`, logo, first `agent-runner` module split
- **EE4.1**: Incremental WSL/Lima sandbox sync, `config-store` split, session handoff + `/handsoff`, unified Windows branding, 30 `agent-runner` unit tests
- **EE4.2**: Major structural refactors (no intended user-facing behaviour change):
  - `index.ts` → ~230 lines (`main-app-*`, `ipc/*`)
  - `gui-operate-server.ts` → entry + `mcp/gui-operate/*` (11 modules)
  - `agent-runner.ts` → ~265 lines (`agent-runner-run`, skills, MCP bridge, PATH, events)
- **God-file cleanup (phase 1)**: `index.ts`, `gui-operate-server.ts`, `agent-runner.ts`, `config-store.ts` — done
- **God-file cleanup (phase 2)**: `agent-runner-run.ts`, `gui-operate/vision.ts`, `mcp-manager.ts`, `session-manager.ts` — done (2026-06-24)
- **God-file cleanup (phase 3)**: `mcp-manager` facade (~363), `vision-workflows`, `agent-runner-pi-setup`, `stream-handler`, `session-manager-facade-support` — done (2026-06-24)
- **God-file cleanup (phase 4)**: `agent-runner-stream-events`, `vision-workflows-plan`, `mcp-tool-registry`, `useApiConfigState` — done (2026-06-24)
- **God-file cleanup (phase 5)**: `use-api-config-state-hook` (~345), `software-dev-server-example` (entry ~24 + `mcp/software-dev/*`), `memory-service` (~201) — done (2026-06-24)
- **Test coverage**: 1043+ unit/integration tests in CI

## 📦 EE releases

| Tag            | Date       | Highlights                                              |
| -------------- | ---------- | ------------------------------------------------------- |
| `v3.3.1-EE4.2` | 2026-06-24 | Refactor `index.ts`, `gui-operate`, `agent-runner`      |
| `v3.3.1-EE4.1` | 2026-06-23 | Sandbox sync, config-store, handoff, branding           |
| `v3.3.1-EE4`   | 2026-06-23 | Slash autocomplete, agent-runner split (phase 1)        |
| `v3.3.1-EE3.x` | 2026-06    | Security, WSL sandbox, Windows perf, pi-agent migration |

Current stable fork baseline: **`3.3.1-EE4.2`** — see [CHANGELOG.md](CHANGELOG.md).

## 🚧 In Progress

- **Post-EE4.2 validation**: Windows smoke test (sandbox, GUI MCP, handoff, encrypted config)
- **God-file cleanup (phase 6, optional)**: `gui-runtime.ts` (~1.6k), `mcp-server.ts` (software-dev, ~928), `api-config-persist-actions.ts` (~562)

## 📋 Planned

### Near-term (EE5 / v3.4.0)

- **Sandbox Hardening**: VM sandbox reliability, startup performance, cross-platform consistency (Lima, WSL2); incremental sync follow-ups
- **App Slimming**: Reduce installer from ~156 MB to ~80 MB — on-demand Python/Node.js download, lazy-load Feishu SDK, strip unused files
- **Naming Standardization**: Clean up legacy references (`claude-sdk`, `claude-sandbox`, `claude-plugin`, `pi-coding-agent`) to consistent Open Cowork naming
- **Tool Completeness**: Native TodoWrite, AskUserQuestion, Glob, Grep, WebFetch, WebSearch tool schemas + handlers for API key users
- **Memory System Enhancements**: Prompt injection controls, cross-session retrieval UX, memory source inspection, reranking quality
- **Scheduled Tasks**: Cron-like scheduling with UI management (backend exists; polish UX and edge cases)
- **Log Management**: Structured logging with rotation, size limits, log viewer improvements
- **Installation Experience**: Smoother first-run — auto-detect dependencies, clearer errors, one-click setup
- **Linux Support**: First-class Linux builds (currently build-from-source only)

### Mid-term (v3.5.0+)

- **Plugin System**: Extensible architecture for community-built integrations
- **Multi-Agent**: Orchestrate multiple agents for complex workflows
- **Workspace Templates**: Pre-configured environments for common use cases (coding, writing, research)

### Long-term

- **Computer Use (CUA)**: GUI automation via screen capture and mouse/keyboard control (GUI MCP server already provides foundation)
- **Collaborative Mode**: Multiple users sharing a workspace
- **Mobile Companion**: Lightweight mobile app for monitoring and quick interactions

---

_Last updated: 2026-06-24 (phase 4 god-file cleanup)_  
_Want to contribute? Check [CONTRIBUTING.md](CONTRIBUTING.md)._
