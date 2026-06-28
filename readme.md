<p align="center">
  <img src="resources/logo.png" alt="Lygodactylus Logo" width="200" />
</p>

<h1 align="center">Lygodactylus</h1>

<p align="center">
  Fork personnel de <a href="https://github.com/OpenCoworkAI/open-cowork">Open Cowork</a> par <a href="https://github.com/Emilien-Etadam">Emilien-Etadam</a>
</p>

<p align="center">
  <a href="./README_en.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-5.8.1-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## C'est quoi ?

**Lygodactylus** est une application desktop d'agent IA (Electron) pour Windows, macOS et Linux. Elle gère vos fichiers, génère des documents via **Skills** (PDF, XLSX embarqués ; DOCX/PPTX téléchargés à la demande), installe des extensions via une **marketplace** curated (Skills, MCP, plugins), isole les commandes dans un **sandbox** (WSL2 / Lima), expose un **chat LAN** (interface web sur le réseau — usage recommandé via tunnel WireGuard), et propose des **outils natifs** (glob, grep, web, todos, questions interactives) compatibles LiteLLM / vLLM / Qwen.

> [!NOTE]
> Ce dépôt est un **fork personnel app-only** (pas de site VitePress ni bots upstream). La série **v5.x** est en **alpha** expérimentale. Les anciennes releases `EE*` restent disponibles mais ne sont plus la branche active. Pour la version stable officielle upstream, voir [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## Ce que ce fork ajoute

### Agent & modèles

- **12 langues** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — avec localisation backend (erreurs, dialogues)
- **Outils natifs (v5.7+)** — `glob`, `grep`, `web_fetch`, `web_search`, `http_request`, `todo_write`, `ask_user_question` (schémas TypeBox plats pour LiteLLM → vLLM → Qwen)
- **AskUserQuestion** — questions interactives inline dans le chat (IPC dédié)
- **Mémoire (v5.6+)** — panneau « Mémoire utilisée », toggle par session, ranker unifié, politique d'injection configurable (`escape` / `strip-suspicious` / `block`)
- **Config API simplifiée** — deux profils : OpenAI-compatible et Anthropic-compatible
- **Détection automatique des modèles** pour les endpoints API distants
- **Compaction proactive** — compact automatique quand le contexte est presque plein
- **Fork / édition de messages** — nouvelle session depuis un message ou modification du prompt utilisateur
- **Commandes slash** — autocomplétion `/` dans le chat, dont les commandes des plugins installés
- **Thème VS Code**, **copier/coller** Windows, **toggle sandbox**, **pi-coding-agent 0.80.2** (`@earendil-works`)

### Extensions & documents

- **Marketplace unifiée** — Réglages → Extensions : skills, connecteurs MCP et plugins (catalogue curated, 21+ entrées)
- **Skills on-demand (v5.4+)** — `docx` et `pptx` (~2.7 MB) téléchargés depuis GitHub Releases au premier usage ; `pdf`, `xlsx`, `skill-creator` embarqués
- **Runtimes on-demand (v5.3+)** — Node.js, Python 3.10 et cliclick (macOS) téléchargés dans `userData` au premier usage (installateur allégé)

### Réseau & sandbox

- **Chat LAN** — serveur web local pour discuter avec l'agent depuis un navigateur (Réglages → Chat LAN ; recommandé via VPN WireGuard)
- **Sandbox LAN network (v5.8+)** — accès réseau local depuis le sandbox sans le désactiver : proxy hôte authentifié (opt-in Réglages), filtrage RFC1918 ; `http_request` et `web_fetch` avec en-têtes personnalisés via la pile réseau hôte

### Distribution

- **Mises à jour** — auto-update Windows + bouton « Vérifier les mises à jour » (Réglages → Général)
- **Linux (v5.6+)** — builds AppImage x64 publiés sur GitHub Releases

### Retiré par rapport à upstream / anciennes versions EE

- **Feishu / contrôle à distance** — intégration Feishu, gateway WebSocket, Slack et tunnel ngrok supprimés (remplacés par Chat LAN)
- **Site web VitePress** — documentation site retirée du dépôt (v5.8) ; docs dans `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`
- **Bots & gouvernance upstream** — Codex PR review, templates CONTRIBUTING/CODEOWNERS upstream retirés (repo app-only)

---

## Installation

### Releases (recommandé)

Téléchargez la dernière version sur la page [Releases](https://github.com/emilien-etadam/lygodactylus/releases) :

| Plateforme            | Fichier     |
| --------------------- | ----------- |
| Windows               | `.exe`      |
| macOS (Apple Silicon) | `.dmg`      |
| Linux (x64)           | `.AppImage` |

Sur **Windows**, l'app vérifie les mises à jour au démarrage. Sur **macOS/Linux**, utilisez **Réglages → Général → Vérifier les mises à jour**.

> [!TIP]
> Au premier usage, Node.js, Python et les skills lourds (`docx`/`pptx`) peuvent être téléchargés automatiquement depuis les releases GitHub officielles.

### Depuis les sources

```bash
git clone https://github.com/emilien-etadam/lygodactylus.git
cd lygodactylus
npm install   # Node.js 22.19+
npm run dev
```

Pour construire un installeur local :

| Plateforme | Commande              |
| ---------- | --------------------- |
| Windows    | `npm run build:win`   |
| Linux      | `npm run build:linux` |
| macOS      | `npm run build`       |

---

## Démarrage rapide

1. Ouvrez l'app et allez dans **Réglages** (icône ⚙️ en bas à gauche).
2. Configurez un fournisseur **OpenAI-compatible** ou **Anthropic-compatible** (clé API + URL de base).
3. Installez des extensions dans **Réglages → Extensions** (MCP, skills, plugins).
4. Choisissez un **dossier workspace** — l'agent ne travaillera que dans ce répertoire.
5. Envoyez un prompt, tapez `/` pour les commandes slash, ou activez le **Chat LAN** pour accéder au chat via le navigateur (de préférence via un tunnel WireGuard).
6. Pour accéder à des services LAN depuis le sandbox, activez **Réglages → Sandbox → Accès réseau LAN sandbox** (opt-in).

Pour le détail des releases, voir [`CHANGELOG.md`](CHANGELOG.md).

---

## Licence & crédits

MIT — basé sur [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) par l'équipe upstream. Voir [`LICENSE`](LICENSE) et [`SECURITY.md`](SECURITY.md).

Maintenu par [Emilien-Etadam](https://github.com/Emilien-Etadam).
