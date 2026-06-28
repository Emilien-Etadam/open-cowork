# 🗺️ Lygodactylus Roadmap

> Development direction for the [Emilien-Etadam/lygodactylus](https://github.com/Emilien-Etadam/lygodactylus) fork (alpha series **v5.x**; legacy `3.3.1-EE*` archived).
> For feature requests and discussion, see [GitHub Issues](https://github.com/Emilien-Etadam/lygodactylus/issues).

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
- **Remote Control**: ~~Feishu (Lark) bot integration~~ — **supprimé** en post-EE4.91 (#40, #41) ; remplacé par chat LAN (#44)
- **CI/CD**: Automated builds, smoke tests, Codex-powered PR review bot
- **Model Presets**: Up-to-date model catalogs for all major providers
- **Dependency Policy**: Tiered management strategy with Dependabot grouping
- **Memory System Foundation**: Unified storage with core/experience memory and source-aware retrieval workflow

### EE fork (`3.3.1-EE1` → `3.3.1-EE4.98`)

- **EE4.98** (release) : rebranding complet **Lygodactylus** (`com.lygodactylus.app`)
- **EE4.97** (release) : compaction proactive contexte plein ; fork/édition prompt sur messages utilisateur ; barre contexte sidebar uniquement (#47, #48)
- **EE4.96** (release) : fix chat streaming en direct (multicast IPC preload — listener plugin n’écrase plus `useIPC`) ; barre de contexte au-dessus de la zone de saisie (#45)
- **EE4.95** (release) : fix auto-update Windows — `latest.yml` aligné sur `Lygodactylus-*.exe`, erreur téléchargement affichée dans Paramètres
- **EE4.94** (release) : fix Chat LAN « UI missing » — `resources/chat-lan` dans extraResources Windows/macOS/Linux
- **EE4.93** (release) : fix UI mises à jour Windows — téléchargement auto + bouton installer
- **EE4.92** (release publiée, Latest) :
  - **Chat LAN** : serveur web local, UI `resources/chat-lan/`, onglet Paramètres (#44)
  - **Config API** : deux fournisseurs (OpenAI-compatible + Anthropic-compatible), migration auto (#42)
  - **Suppression** Feishu (#40) et module contrôle à distance complet (#41)
  - App allégée (~7k lignes remote retirées, `@larksuiteoapi/node-sdk` supprimé)
- **EE4.91** :
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

## 📦 Releases

| Tag             | Date       | Highlights                                                                                 |
| --------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `v5.5.0`        | 2026-06-28 | **Latest** — naming standardization (paths agent, sandbox, Lima)                             |
| `v5.4.0`        | 2026-06-28 | skills split on-demand (docx/pptx), lazy-load SDKs, ~2.7 MB installer savings              |
| `v5.3.0`        | 2026-06-28 | slimming on-demand (Node, Python, cliclick), 1086 tests                                    |
| `v5.1.0`        | 2026-06-27 | Hardening v5 (phases 0–3), pi-agent 0.80.2, Node 22.19, slimming quick wins                |
| `v5.0.0`        | 2026-06-27 | logo gecko Lygodactylus, série v5, rebranding complet                                      |
| `v3.3.1-EE4.98` | 2026-06-26 | rebranding Lygodactylus                                                                    |
| `v3.3.1-EE4.97` | 2026-06-25 | compaction proactive, fork/édition prompt, barre contexte sidebar                          |
| `v3.3.1-EE4.96` | 2026-06-25 | Fix chat streaming + barre de contexte au-dessus de l’input                                |
| `v3.3.1-EE4.95` | 2026-06-25 | Fix auto-update Windows (`latest.yml` + nom installateur)                                  |
| `v3.3.1-EE4.94` | 2026-06-25 | Fix Chat LAN UI missing (extraResources)                                                   |
| `v3.3.1-EE4.93` | 2026-06-25 | Fix auto-update Windows (download + bouton installer)                                      |
| `v3.3.1-EE4.92` | 2026-06-25 | Chat LAN, 2 providers API, suppression remote/Feishu                                       |
| `v3.3.1-EE4.91` | 2026-06-25 | Hotfix vérification mises à jour, `createRequire`, GitHub API                              |
| `v3.3.1-EE4.9`  | 2026-06-25 | Fix chat « Traitement… », slash plugin, CI release                                         |
| `v3.3.1-EE4.8`  | 2026-06-25 | Mises à jour EE4.8, fix chat bloqué, slash plugin (non publiée — draft)                    |
| `v3.3.1-EE4.7`  | 2026-06-25 | Fix fond opaque menu slash                                                                 |
| `v3.3.1-EE4.6`  | 2026-06-25 | Auto-update Windows, commandes plugin menu `/`                                             |
| `v3.3.1-EE4.5`  | 2026-06-24 | Catalogue 21 entrées, fix Context7 + Chrome MCP, 1048 tests                                |
| `v3.3.1-EE4.4`  | 2026-06-24 | Marketplace curated, cleanup legacy plugins, 1035 tests                                    |
| `v3.3.1-EE4.3`  | 2026-06-24 | God-file cleanup phases 2–6, 1043 tests                                                    |
| `v3.3.1-EE4.2`  | 2026-06-24 | Refactor `index.ts`, `gui-operate`, `agent-runner`                                         |
| `v3.3.1-EE4.1`  | 2026-06-23 | Sandbox sync, config-store, handoff, branding                                              |
| `v3.3.1-EE4`    | 2026-06-23 | Slash autocomplete, agent-runner split (phase 1)                                           |
| `v3.3.1-EE3.x`  | 2026-06    | Security, WSL sandbox, Windows perf, pi-agent migration                                    |

Current stable fork baseline: **`5.5.0`** — [CHANGELOG](CHANGELOG.md)

### v5.x hardening

- **Encrypted stores**: MCP credentials + Chat LAN token aligned with machine-bound encryption (`app-store` helper)
- **Dead code removal**: legacy per-skill MCP process stubs removed (MCP via marketplace / `mcp-config-store` only)
- **Docs**: SECURITY.md, README, ROADMAP updated for v5 support policy
- **Phase 1**: macOS sandbox default, IPC allowlist in main process, Chat LAN hardening (Bearer SSE, security headers)
- **Phase 2**: extracted `command-sandbox-validation`, `skills-frontmatter`, `use-ipc-stream-batching`; expanded tool-executor tests; CI coverage floor 40%
- **Phase 3**: migration `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` ^0.80.2 (0 CVE runtime), compat entrypoint for legacy API, DeepSeek V4 thinking patch ported
- **v5.1 prep**: Node `>=22.19.0`, installer slimming (@img removed, MCP minify, locales win/linux), legacy rename `src/main/claude/` → `src/main/agent/`, `pi-ai-one-shot`, `AgentRunner`
- **v5.5 naming**: `userData/skills`, `lygodactylus-sandbox`, `~/.lygodactylus/sandbox`, sync manifest Lygodactylus
- **Validation v5.1.0** (2026-06-27) : smoke tests Chat LAN, migration config deux fournisseurs, régression chat/slash/auto-update — validés

## 📋 Planned

### Near-term (v5.2+)

- **Sandbox Hardening**: VM sandbox reliability, startup performance, cross-platform consistency (Lima, WSL2); incremental sync follow-ups
- **App Slimming**: Node.js on-demand — **done v5.2**; Python + cliclick on-demand — **done v5.3**; skills split (docx/pptx on-demand) — **done v5.4**; naming cleanup — **done v5.5**
- **Schema naming**: `claude_session_id`, `claudeCodePath` → `agent_session_id`, `agentCliPath` — **done v5.5** (migration auto, champs legacy conservés en lecture)
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

_Last updated: 2026-06-28 (v5.5.0 release)_  
_Want to contribute? Check [CONTRIBUTING.md](CONTRIBUTING.md)._
