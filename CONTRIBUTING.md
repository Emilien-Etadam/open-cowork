# Contributing to Lygodactylus (Fork EE)

Thank you for your interest in contributing! This repository is a **personal fork** of [Open Cowork](https://github.com/OpenCoworkAI/open-cowork), maintained by [Emilien-Etadam](https://github.com/Emilien-Etadam). Releases are tagged `3.3.1-EE*` (alpha).

Upstream contributions should generally go to [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork). Use this fork for EE-specific features, marketplace curation, and fork UX.

---

## Development Setup

**Requirements**

- Node.js 22 (matches CI)
- npm 10+
- macOS or Windows

**Install**

```bash
git clone https://github.com/Emilien-Etadam/lygodactylus.git
cd lygodactylus
npm install        # postinstall: downloads Node binaries + rebuilds native modules
```

**Common commands**

| Command            | Purpose                            |
| ------------------ | ---------------------------------- |
| `npm run dev`      | Start dev server (Vite + Electron) |
| `npm run lint`     | ESLint over `src/**/*.{ts,tsx}`    |
| `npm run format`   | Prettier write                     |
| `npx tsc --noEmit` | Type-check without emitting        |
| `npm run test`     | Run Vitest                         |
| `npm run build`    | Full production build              |

---

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── agent/               # Agent runner (pi-coding-agent)
│   ├── config/              # Settings, API keys, provider migration
│   ├── mcp/                 # MCP lifecycle (stdio / SSE / Streamable HTTP)
│   ├── session/             # Sessions, compaction, message branching
│   ├── sandbox/             # WSL2 (Windows) / Lima (macOS)
│   ├── skills/              # Skills + plugin runtime
│   ├── catalog/             # Curated marketplace (manifest + install)
│   ├── chat-lan-server/     # Local web UI for LAN chat
│   ├── memory/              # Core + experience memory
│   └── schedule/            # Scheduled tasks
└── renderer/                # React frontend
    ├── components/          # UI (ChatView, Settings, marketplace…)
    ├── hooks/               # IPC, API config
    ├── i18n/locales/        # 12 UI languages
    └── store/               # Zustand state

catalog/manifest.json        # Curated marketplace whitelist
```

Tests live in `src/tests/` or `tests/`, mirroring source paths.

---

## Code Style

- **TypeScript strict mode** — no implicit `any`
- **ESLint + Prettier** — run `npm run lint` and `npm run format` before pushing
- **React functional components** with hooks only
- **Tailwind CSS** for styling
- **Icons** — `lucide-react` only

---

## Git Workflow

**Branch naming** (fork convention)

```
cursor/<description>-7e4e    # feature branches (Cloud Agent / PR workflow)
main                          # integration & EE releases
```

**Conventional Commits** (enforced by commitlint + husky):

```
<type>(<scope>): <short summary>
```

Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `chore`, `ci`, `style`, `revert`, `release`

Examples:

```
feat(marketplace): add playwright MCP entry
fix(chat-lan): resolve packaged UI path
docs: update SECURITY.md for fork EE
```

---

## Pull Request Guidelines

1. **Target `main`** for all PRs on this fork.
2. **Tests required** for `feat` and `fix` — CI must pass lint, typecheck, and `npm run test:coverage`.
3. Keep component files under **500 lines**; split when larger.
4. No `any` — use `unknown` + type guards.
5. Keep changes focused; avoid unrelated refactors.
6. Update `CHANGELOG.md` for user-visible EE changes.

---

## Dependency Management

Same tiered policy as upstream (Dependabot in `.github/dependabot.yml`).

**Manual review always required for:**

- `electron`
- `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`
- `better-sqlite3`
- `vite` / `@vitejs/plugin-react`

Before adding a dependency: check license (MIT/Apache/BSD/ISC), size, and maintenance activity.

---

## Testing

```bash
npm run test               # watch mode
npx vitest run             # single run (CI)
npm run test:coverage      # with coverage thresholds
```

---

## i18n

All user-visible strings go through **i18next**. Translation files: `src/renderer/i18n/locales/` (**12 languages**).

When adding UI text, update **all** locale files (`en`, `fr`, `zh`, `es`, `de`, `it`, `uk`, `pl`, `sv`, `no`, `nl`, `ro`). Backend strings use `src/main/i18n/`.

---

## Curated Marketplace

Extensions are defined in [`catalog/manifest.json`](catalog/manifest.json) (curated-strict).

1. Add a verified entry with a `resolve` block (`builtin`, `preset`, `mcp-registry`, or `github`).
2. Pin MCP versions when possible (`pinVersion`).
3. Run `npm run test -- tests/catalog-manifest-validation.test.ts`.
4. Test install from **Réglages → Extensions**.

MCP stdio servers execute local code — review sources carefully. No open self-service publishing.

---

## Reporting Issues

Open issues on [Emilien-Etadam/lygodactylus](https://github.com/Emilien-Etadam/lygodactylus/issues).

Include:

- Version (`3.3.1-EE4.97` or build from commit)
- OS (Windows / macOS + version)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

**Security issues** — see [SECURITY.md](SECURITY.md). Do not file public issues for vulnerabilities.

For bugs in shared upstream behavior, consider reporting to [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork/issues) as well.
