# Changelog

All notable changes to the Lygodactylus AI agent desktop app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.7.0] - 2026-06-28

### Added

- **Tool Completeness** : outils natifs `glob`/`find`, `grep`, `web_fetch`, `web_search`, `todo_write`, `ask_user_question` avec alias PascalCase pour compatibilité historique
- Schémas TypeBox plats optimisés pour **LiteLLM → vLLM → Qwen 3.6 27B** (tool calling OpenAI-compatible)
- **AskUserQuestion** interactif : IPC `question.request` / `question.response`, UI inline avec soumission des réponses

### Changed

- `buildNativeCustomTools` branché dans `agent-runner-pi-setup` aux côtés de la recherche web et des outils MCP

## [5.6.0] - 2026-06-28

### Added

- **Memory UX** : panneau « Mémoire utilisée » dans le chat, toggle mémoire par session, scores de pertinence dans Paramètres
- **Memory hardening** : sanitization à l'ingestion, politique d'injection configurable (`escape` / `strip-suspicious` / `block`), ranker unifié (lexical + embedding + workspace + recency)
- **Linux releases** : build CI AppImage x64, script `npm run build:linux`, publication sur GitHub Releases

### Changed

- `MemoryRetriever` utilise le même ranker que la récupération runtime ; `sourceExcerpt` peuplé à la lecture
- Config mémoire : `chunkTopK`, `sessionTopK`, `injectionPolicy`, `showInjectedMemoryInChat`

## [5.5.0] - 2026-06-28

### Changed

- **Chemins agent** : `userData/claude/{skills,plugins}` → `userData/{skills,plugins}` avec migration automatique au démarrage
- **Sandbox VM** : `~/.claude/sandbox` → `~/.lygodactylus/sandbox` (sessions legacy conservées)
- **Lima** : instance `claude-sandbox` → `lygodactylus-sandbox` (détection des deux noms)
- **Manifeste sync** : `.opencowork-sync.json` → `.lygodactylus-sync.json` (lecture legacy)
- Préfixes temporaires `opencowork-*` → `lygodactylus-*` (plugins, export logs)
- Skills sandbox : `{sandbox}/skills` au lieu de `{sandbox}/.claude/skills`
- **Schéma** : colonne SQLite `agent_session_id` (migration depuis `claude_session_id`) ; config `agentCliPath` (migration depuis `claudeCodePath`)

## [5.4.0] - 2026-06-28

### Added

- **Skills on-demand** : `docx` et `pptx` (~2.7 MB) retirés de l'installateur ; téléchargement depuis GitHub Releases au premier usage (`userData/runtimes/skills/{version}/`)
- **Skill bundles CI** : job `skill-bundles` publie `lygodactylus-skill-{docx|pptx}-v{version}.tar.gz` sur chaque release
- **Lazy-load SDKs** : `openai` et `@anthropic-ai/sdk` chargés à la demande (embed mémoire, diagnostics API)

### Changed

- **Skills core** : seuls `pdf`, `xlsx`, `skill-creator` embarqués via `resources/skills-core/`
- Migration automatique depuis les anciens bundles `extraResources/skills` complets (docx/pptx inclus)
- Preflight : avertissement si skills lourds pas encore téléchargés

## [5.3.0] - 2026-06-28

### Added

- **Python on-demand** : runtime Python 3.10.19 (python-build-standalone) téléchargé dans `userData` au premier usage GUI — Pillow + pyobjc sur macOS (~30–45 MB économisés sur l'installateur)
- **cliclick on-demand** (macOS) : téléchargement/copie à la demande avec repli Quartz si absent
- **Détection automatique des modèles** pour les endpoints API distants (#63)

### Changed

- **Node.js on-demand** : le runtime Node n'est plus embarqué dans l'installateur ; téléchargement automatique dans `userData` au premier usage MCP (~25–35 MB économisés sur Windows)
- Migration automatique depuis les anciens bundles `extraResources` (node, python, tools) si présents
- **1086 tests** passent en CI

## [5.1.0] - 2026-06-27

### Added

- **Hardening v5 (phases 0–3)** : stores MCP/Chat LAN chiffrés, sandbox macOS/Windows activé par défaut, allowlist IPC côté main, durcissement Chat LAN (Bearer SSE, en-têtes sécurité)
- **Qualité** : extractions modules (`command-sandbox-validation`, `skills-frontmatter`, `use-ipc-stream-batching`), tests tool-executor, seuil couverture CI 40 %
- **Sécurité dépendances** : migration `@earendil-works/pi-ai` / `pi-coding-agent` ^0.80.2 — **0 CVE runtime** (patch DeepSeek V4 porté)

### Changed

- **Node** : `engines` >= 22.19.0 (aligné earendil 0.80.2), CI/release sur Node 22.19
- **Allègement installateur** : retrait `@img`/sharp des artifacts, minify bundles MCP, locales Electron réduites (win/linux)
- **Renommage interne** : `src/main/claude/` → `src/main/agent/`, `AgentRunner`, `pi-ai-one-shot`, `probeWithPiAi` / `generateTitleWithPiAi`
- **1075 tests** passent en CI

## [5.0.0] - 2026-06-27

### Changed

- **Versioning** : passage à la série **v5** (semver `5.0.0`)
- **Logo** : nouveau gecko bleu Lygodactylus (`logolygo.png`) — icônes app, tray, favicon et UI régénérés
- **Rebranding** : application **Lygodactylus** (`com.lygodactylus.app`, dépôt `Emilien-Etadam/lygodactylus`)
- **Recherche web** : providers configurables (DuckDuckGo, SearXNG, YaCy)

## [3.3.1-EE4.98] - 2026-06-26

### Changed

- **Rebranding** : l'application s'appelle désormais **Lygodactylus** (`com.lygodactylus.app`, installeurs `Lygodactylus-*`)
- **Dépôt GitHub** : renommé en `Emilien-Etadam/lygodactylus` (URLs du projet mises à jour)
- Identifiants internes, i18n (12 langues), installateur Windows et script de nettoyage legacy mis à jour
- Les clés de chiffrement legacy Open Cowork restent supportées pour la rotation des configs existantes

## [3.3.1-EE4.97] - 2026-06-25

### Added

- **Messages utilisateur** : icônes fork (nouvelle session depuis ce message) et édition prompt (rewind + zone de saisie)
- IPC `session.forkFromMessage` et `session.rewindToMessage`

### Fixed

- **Compaction auto** : appel explicite à `compact()` avant `prompt()` quand le contexte est plein (~98 %+)
- **Barre de contexte** : une seule barre dans le panneau Contexte (sidebar) — suppression du doublon au-dessus de l’input
- **Erreur contexte plein** : hint `/compact` au lieu du message trompeur « réessaie automatiquement »

## [3.3.1-EE4.96] - 2026-06-25

### Fixed

- **Chat** : réflexion et réponses en streaming réaffichées en direct (multicast IPC — le listener plugin n’écrase plus `useIPC`)
- **Barre de contexte** : réintégrée au-dessus de la zone de saisie ; visible même panneau Contexte replié
- **Contexte** : affichage dès que la fenêtre est connue (réservation `maxTokens` incluse)

## [3.3.1-EE4.95] - 2026-06-25

### Fixed

- **Auto-update Windows** : `latest.yml` pointait vers `Lygodactylus-*.exe` au lieu de `Lygodactylus-*.exe` (téléchargement 404)
- Script CI `sync-windows-latest-yml.mjs` pour aligner le YAML sur le nom réel de l’installateur
- Affichage de l’erreur de téléchargement automatique dans Paramètres

## [3.3.1-EE4.94] - 2026-06-25

### Fixed

- **Chat LAN** : UI `index.html` introuvable en build packagé — copie via `extraResources` + résolution `process.resourcesPath`

## [3.3.1-EE4.93] - 2026-06-25

### Fixed

- **Mises à jour Windows** : attendre le téléchargement `electron-updater` avant d’afficher le résultat (bouton « Redémarrer et installer »)
- **UI mises à jour** : ne plus afficher « Windows uniquement » sur Windows ; message manuel réservé à macOS/Linux

## [3.3.1-EE4.92] - 2026-06-25

### Added

- **Chat LAN** : serveur web local avec UI (`resources/chat-lan/`), permissions et onglet Paramètres dédié (#44)
- **Config API** : deux fournisseurs uniquement — OpenAI-compatible et Anthropic-compatible, avec migration automatique (#42)

### Removed

- **Feishu** : intégration remote Feishu/Lark supprimée (#40)
- **Contrôle à distance** : module complet supprimé (gateway WebSocket, Slack, tunnel ngrok, panneau UI) (#41)

### Changed

- Dépendances allégées (`@larksuiteoapi/node-sdk`, code remote ~7k lignes retirées)

## [3.3.1-EE4.91] - 2026-06-25

### Fixed

- **Vérification des mises à jour** : chargement `electron-updater` via `createRequire` (`autoUpdater` undefined avec `import()` ESM)
- **Vérification des mises à jour** : repli API GitHub Releases si `electron-updater` échoue
- **Auto-update Windows** : `allowPrerelease = false` pour ignorer les releases draft du feed GitHub
- **CI** : lint `@typescript-eslint/no-var-requires` corrigé sur `auto-updater.ts`
- **PRs #36–#42** : rebasées sur `main`, handlers IPC update dédupliqués (`ipc-auto-update`)

## [3.3.1-EE4.9] - 2026-06-25

### Added

- **Bouton « Vérifier les mises à jour »** dans Paramètres → Général
- Affichage de la version au format **EE4.9** dans l’interface
- Vérification via `electron-updater` (Windows) ou API GitHub Releases (macOS/Linux)

### Fixed

- **Chat** : correction du blocage infini « Traitement… » après intégration des commandes plugin
- **Commandes slash** : rejet des commandes inconnues et normalisation `/plugin:cmd` pour le SDK Pi
- **CI** : test `session-manager-crud` aligné avec le reset des sessions `running` au démarrage

## [3.3.1-EE4.8] - 2026-06-25

### Added

- **Bouton « Vérifier les mises à jour »** dans Paramètres → Général
- Affichage de la version au format **EE4.8** dans l’interface
- Vérification via `electron-updater` (Windows) ou API GitHub Releases (macOS/Linux)

### Fixed

- **Chat** : correction du blocage infini « Traitement… » après intégration des commandes plugin
- **Commandes slash** : rejet des commandes inconnues et normalisation `/plugin:cmd` pour le SDK Pi

## [3.3.1-EE4.7] - 2026-06-25

### Fixed

- **Menu slash** : fond opaque (`bg-surface`) — l'historique du chat ne transparaît plus derrière l'autocomplétion `/`

## [3.3.1-EE4.6] - 2026-06-25

### Added

- **Auto-update Windows** depuis les releases GitHub du fork EE (`latest.yml`, `electron-updater`)
- **Commandes plugin** intégrées au menu slash (`/`)

## [3.3.1-EE4.5] - 2026-06-24

### Added

- Catalogue marketplace enrichi : **21 entrées** (manifest v2) — plugins workflow Anthropic + intégrations GitHub, Playwright, Linear, GitLab
- Test CI `catalog-github-paths` : validation des chemins GitHub du manifest

### Fixed

- **Context7** : chemin d’installation corrigé (`external_plugins/context7`)
- **Chrome MCP** : `marketplace.install` ne bloque plus si le port debug 9222 n’est pas prêt
- Démarrage Chrome : détection Linux améliorée (`google-chrome-stable`, `chromium`) + erreurs spawn async

### Tests

- Suite CI : **1048** tests unitaires/intégration

## [3.3.1-EE4.4] - 2026-06-24

### Added

- Marketplace unifiée **curated strict** (Skills + MCP + Plugins) dans l’onglet Extensions
- `catalog/manifest.json` : whitelist vérifiée avec résolution builtin, preset, MCP Registry et GitHub
- Backend marketplace : agrégateur, install resolver, store des extensions installées
- Mise à jour OTA du catalogue avec indicateur source remote/bundled
- Validation CI du manifest catalogue

### Changed

- Onglet Settings **Extensions** remplace les anciens onglets Skills / Connectors
- MCP manuel déplacé dans la section avancée (`MarketplaceMcpAdvanced`)

### Removed

- Scrape Anthropic legacy (`PluginCatalogService`) et installation via Claude CLI
- Handlers IPC `plugins.listCatalog` / `plugins.install`
- Composants UI legacy `SettingsSkills` / `SettingsConnectors`
- Clés i18n orphelines `skills.plugin*` (22 clés × 11 locales)

### Tests

- Suite CI : **1035** tests unitaires/intégration
- Tests de validation `catalog/manifest.json`

## [3.3.1-EE4.3] - 2026-06-24

### Changed

- Refactor (god-file cleanup phases 2–6, sans changement de comportement prévu) :
  - **Phase 2** : `session-manager`, `agent-runner-run`, `vision.ts`, `mcp-manager`
  - **Phase 3** : facade `mcp-manager`, `vision-workflows`, `agent-runner-pi-setup`, `stream-handler`, `session-manager-facade-support`
  - **Phase 4** : `agent-runner-stream-events`, `vision-workflows-plan`, `mcp-tool-registry`, `useApiConfigState`
  - **Phase 5** : `use-api-config-state-hook`, `memory-service`, `software-dev-server-example` (+ modules `mcp/software-dev/*`, `memory-service-*`, `api-config-*`)
  - **Phase 6** : `gui-runtime`, `mcp-server` software-dev, `api-config-persist-actions`

### Tests

- Suite CI : **1043** tests unitaires/intégration
- Mocks MCP reconnect et inspections mémoire alignés sur les nouveaux modules

## [3.3.1-EE4.2] - 2026-06-24

### Changed

- Refactor : découpage de `index.ts` en modules (window, IPC, lifecycle) — 2914 → ~230 lignes
- Refactor : découpage de `gui-operate-server.ts` en 11 modules sous `mcp/gui-operate/` — 6884 → ~24 lignes (entry)
- Refactor : suite du découpage `agent-runner.ts` — 2520 → ~265 lignes (`run`, skills, MCP bridge, PATH, events)

## [3.3.1-EE4.1] - 2026-06-23

### Added

- Tests unitaires pour les modules `agent-runner` extraits (30 tests : `pi-session`, `sandbox-bootstrap`, `history`)
- Sync sandbox incrémental WSL/Lima : pull host→sandbox à la réutilisation de session, skip export si fichier inchangé
- Découpage de `config-store` en modules (`config-schema`, `config-normalizer`, `config-provider-runtime`)

### Changed

- Branding : logo unifié et identité Electron corrigée sur Windows (icônes tray, génération automatique)

### Fixed

- Handoff de session : bootstrap UI corrigé, alias `/handsoff` accepté
- Test flaky `recent-workspace-files` : timestamps explicites via `fs.utimes` au lieu de `setTimeout`

## [3.3.1-EE4] - 2026-06-23

### Added

- Autocomplétion des commandes slash (`/`) dans le champ de prompt
- `README_en.md` et logo Lygodactylus

### Changed

- Refactor : découpage de `agent-runner.ts` en 3 modules (`history`, `sandbox-bootstrap`, `pi-session`)
- Documentation : suppression de `README_zh.md`

### Fixed

- CI : Codex PR Review ignoré si aucune clé API n'est configurée

## [3.3.0] - 2026-04-18

First stable release of the 3.3.x series. Graduated from 9 beta releases with 30+ commits since beta.9.

### Added

- Pairing mode UI guidance and approval panel for Feishu remote control (#109)
- Official project website with VitePress (#122)
- Codex-powered PR review bot with GPT-5.3-codex (#94)
- Codex issue auto-response workflow (#95)
- Platform-based issue auto-assignment (#96)
- ROADMAP.md with versioned planning (v3.4.0+)
- SEO optimizations — llms.txt, social preview, FAQ
- Dependency management policy in CONTRIBUTING.md

### Fixed

- Feishu DM policy now correctly syncs to gateway auth mode (#107)
- Feishu WebSocket connection failures (#93, #105)
- Screenshot tool results display as images instead of bloating text context (#135, #124)
- GUI tool-result image deduplication via content hashing
- Gemini and other providers: empty probe response handling (#88)
- Model probe error causes now preserved in diagnostics (#121)
- MCP: prefer system npx on Windows (#120)
- Security: zip-slip and path traversal hardening (#139)
- Dark/light theme switching on website
- Outdated model fallbacks updated to current versions (claude-sonnet-4-6, gemini-3-flash-preview, gpt-5.4-mini)

### Changed

- OpenAI model presets updated: gpt-5.4-mini, gpt-5.4-nano, o4-mini (replaced retired gpt-4.1)
- CI: platform builds moved to release-only, smoke tests added
- Dependabot: grouped CI actions, separated production patch/minor, ignored Electron major

### Removed

- Unused credentials store module and Keychain integration (eliminated macOS Keychain popup on startup)

### Contributors

- [@hqhq1025](https://github.com/hqhq1025)
- [@Sun-sunshine06](https://github.com/Sun-sunshine06)
- [@JackXFan](https://github.com/JackXFan)
- [@andoan16](https://github.com/andoan16)

## [3.3.0-beta.8] - 2026-03-29

### Added

- Build verification and post-install reliability checks for Windows and macOS installers
- ~100 test files with coverage thresholds enforced in CI pipeline

### Fixed

- 8 critical + 10 high security findings from Round 3 security audit
- 20 medium-severity hardening fixes across sandbox and MCP modules
- VM sandbox security against command injection and symlink attacks (WSL2 & Lima)
- MCP server staging and lifecycle issues for external tool integration
- Skills ENOTDIR error when built-in skills (PPTX, DOCX, PDF, XLSX) symlink into .asar archive
- Remote gateway null check in `loadPairedUsers` for Feishu/Slack integration
- Scrypt `maxmem` parameter for startup key derivation performance
- CI pipeline stabilization for cross-platform builds

## [3.2.0] - 2026-03-02

### Added

- GUI automation support for Windows desktop applications (computer use with WeChat workflow)
- Drag-and-drop file and image attachments with bubble layout in chat interface

### Changed

- Updated Lygodactylus app icons for Windows and macOS packaging (branding refresh)
- Widened chat content area layout for better readability

### Fixed

- Improved `key_press` robustness for GUI automation on Windows and macOS

## [3.1.0] - 2026-02-13

### Added

- Full V2 plugin runtime and management system for custom MCP connectors
- Demo videos showcasing file organization, PPTX generation, XLSX creation, and GUI operation

### Fixed

- Custom Anthropic API timeout handling for Claude model requests
- Agent runner `sdkPlugins` runtime ReferenceError in multi-model configurations
- Hardcoded Chinese text removed from config modal and titlebar (full English/Chinese localization)
- Sensitive log redaction hardened for API keys and credentials
- Packaged app version alignment to 3.0.0 for consistent update detection

## [3.0.0] - 2026-02-08

### Changed

- **Breaking**: Removed proxy layer — all AI model requests now go through Claude Agent SDK directly
- Architecture redesigned to SDK-first approach for better multi-model support (Claude, OpenAI, Gemini, DeepSeek)

### Fixed

- GUI dock click targeting and verification gating for macOS computer use

## [2.0.0] - 2026-01-25

### Changed

- Major architecture overhaul: Electron-based desktop app with React UI, sandbox isolation, and Skills system

## [1.0.0] - 2025-12-01

### Added

- Initial release of Lygodactylus — open-source AI agent desktop app with one-click install for Windows and macOS

[Unreleased]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.7.0...HEAD
[5.7.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.3.0...v5.7.0
[5.5.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.4.0...v5.5.0
[5.4.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.3.0...v5.4.0
[5.3.0]: https://github.com/Emilien-Etadam/lygodactylus/compare/v5.1.0...v5.3.0
[5.1.0]: https://github.com/Emilien-Etadam/lygodactylus/releases/tag/v5.1.0
[5.0.0]: https://github.com/Emilien-Etadam/lygodactylus/releases/tag/v5.0.0
