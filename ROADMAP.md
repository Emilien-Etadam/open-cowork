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

### EE fork (`3.3.1-EE1` → `3.3.1-EE4.91`)

- **EE4.91** (release publiée, Latest) :
  - Hotfix bouton « Vérifier les mises à jour » (`Cannot set properties of undefined (setting 'allowPrerelease')`)
  - Chargement `electron-updater` via `createRequire` (interop CJS — `autoUpdater` absent en `import()` ESM)
  - Repli API GitHub Releases si `electron-updater` indisponible (macOS/Linux + secours Windows)
  - `allowPrerelease = false` pour ignorer les releases draft/prerelease sur le feed GitHub
- **EE4.9** :
  - Fix blocage chat infini « Traitement… » (timeout `preparePiSessionRun` / `resourceLoader.reload`, cycle `activeTurn`, reset sessions `running` orphelines)
  - Commandes slash : rejet des inconnues, normalisation `/plugin:cmd` → `/cmd`
  - CI release débloquée (test `session-manager-crud`)
- **EE4.8** : bouton vérification mises à jour, mêmes correctifs chat/slash (supersédé par EE4.9)
- **EE4.7** : menu slash fond opaque (fix transparence sur l'historique)
- **EE4.6** : auto-update Windows, commandes plugin dans le menu `/`

- **EE4**: Slash command autocomplete, `README_en.md`, logo, first `agent-runner` module split
- **EE4.1**: Incremental WSL/Lima sandbox sync, `config-store` split, session handoff + `/handsoff`, unified Windows branding, 30 `agent-runner` unit tests
- **EE4.2**: Major structural refactors (no intended user-facing behaviour change):
  - `index.ts` → ~230 lines (`main-app-*`, `ipc/*`)
  - `gui-operate-server.ts` → entry + `mcp/gui-operate/*` (11 modules)
  - `agent-runner.ts` → ~265 lines (`agent-runner-run`, skills, MCP bridge, PATH, events)
- **EE4.3**: God-file cleanup phases 2–6 — `session-manager`, `mcp-manager`, `memory-service`, software-dev MCP, API config hooks (1043 tests)
- **EE4.4**: Marketplace curated unifiée (Skills/MCP/Plugins), nettoyage legacy Anthropic + Claude CLI, validation CI du catalogue (1035 tests)
- **EE4.5**: Catalogue 21 entrées, fix Context7/Chrome MCP marketplace install (1048 tests)
- **God-file cleanup (phase 1)**: `index.ts`, `gui-operate-server.ts`, `agent-runner.ts`, `config-store.ts` — done
- **God-file cleanup (phase 2)**: `agent-runner-run.ts`, `gui-operate/vision.ts`, `mcp-manager.ts`, `session-manager.ts` — done (2026-06-24)
- **God-file cleanup (phase 3)**: `mcp-manager` facade (~363), `vision-workflows`, `agent-runner-pi-setup`, `stream-handler`, `session-manager-facade-support` — done (2026-06-24)
- **God-file cleanup (phase 4)**: `agent-runner-stream-events`, `vision-workflows-plan`, `mcp-tool-registry`, `useApiConfigState` — done (2026-06-24)
- **God-file cleanup (phase 5)**: `use-api-config-state-hook` (~345), `software-dev-server-example` (entry ~24 + `mcp/software-dev/*`), `memory-service` (~201) — done (2026-06-24)
- **God-file cleanup (phase 6)**: `gui-runtime` (facade ~19), `mcp-server` software-dev (~82), `api-config-persist-actions` (~65) — done (2026-06-24)
- **Test coverage**: 1043+ unit/integration tests in CI

## 📦 EE releases

| Tag              | Date       | Highlights                                                                 |
| ---------------- | ---------- | -------------------------------------------------------------------------- |
| `v3.3.1-EE4.91`  | 2026-06-25 | **Latest** — hotfix vérification mises à jour, `createRequire`, GitHub API   |
| `v3.3.1-EE4.9`   | 2026-06-25 | Fix chat « Traitement… », slash plugin, CI release                         |
| `v3.3.1-EE4.8`   | 2026-06-25 | Mises à jour EE4.8, fix chat bloqué, slash plugin (non publiée — draft)   |
| `v3.3.1-EE4.7`   | 2026-06-25 | Fix fond opaque menu slash                                                 |
| `v3.3.1-EE4.6`   | 2026-06-25 | Auto-update Windows, commandes plugin menu `/`                             |
| `v3.3.1-EE4.5` | 2026-06-24 | Catalogue 21 entrées, fix Context7 + Chrome MCP, 1048 tests |
| `v3.3.1-EE4.4` | 2026-06-24 | Marketplace curated, cleanup legacy plugins, 1035 tests     |
| `v3.3.1-EE4.3` | 2026-06-24 | God-file cleanup phases 2–6, 1043 tests                     |
| `v3.3.1-EE4.2` | 2026-06-24 | Refactor `index.ts`, `gui-operate`, `agent-runner`          |
| `v3.3.1-EE4.1` | 2026-06-23 | Sandbox sync, config-store, handoff, branding               |
| `v3.3.1-EE4`   | 2026-06-23 | Slash autocomplete, agent-runner split (phase 1)            |
| `v3.3.1-EE3.x` | 2026-06    | Security, WSL sandbox, Windows perf, pi-agent migration     |

Current stable fork baseline: **`3.3.1-EE4.91`** — [release](https://github.com/Emilien-Etadam/open-cowork/releases/tag/v3.3.1-EE4.91) · [CHANGELOG](CHANGELOG.md)

## 🚧 In Progress

### PRs ouvertes (CI verte, en attente de revue / merge)

| PR   | Branche                         | Description                                              | CI    |
| ---- | ------------------------------- | -------------------------------------------------------- | ----- |
| #44  | `cursor/lan-chat-webui-2d3f`    | UI web chat locale avec permissions (LAN / WireGuard)    | ✅    |
| #42  | `cursor/local-providers-only-2d3f` | Deux fournisseurs seulement (OpenAI + Anthropic compat.) | ✅    |
| #41  | `cursor/remove-remote-external-2d3f` | Suppression du module contrôle à distance             | ✅    |
| #40  | `cursor/remove-feishu-remote-2d3f`   | Suppression intégration Feishu (Slack only)           | ✅    |
| #36  | `cursor/fix-auto-update-ee-1345`  | Auto-update Windows — drafts + bouton (supersédée par main, à fermer ou merger) | ✅ |

> Les PR #40–#42 ont été rebasées sur `main` (fix test `session-manager-crud`, correctifs EE4.9+).

### Validation post-release

- Smoke test EE4.91 : bouton « Vérifier les mises à jour » (Windows + macOS)
- Auto-update Windows depuis `latest.yml` GitHub Releases
- Régression chat : envoi message, commandes slash plugin, pas de blocage « Traitement… »

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

_Last updated: 2026-06-25 (release EE4.91, PRs rebasées, CI verte)_  
_Want to contribute? Check [CONTRIBUTING.md](CONTRIBUTING.md)._
