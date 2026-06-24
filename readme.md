<p align="center">
  <img src="resources/logo.png" alt="Open Cowork Logo" width="200" />
</p>

<h1 align="center">Open Cowork — Fork EE</h1>

<p align="center">
  Fork personnel de <a href="https://github.com/OpenCoworkAI/open-cowork">Open Cowork</a> par <a href="https://github.com/Emilien-Etadam">Emilien-Etadam</a>
</p>

<p align="center">
  <a href="./README_en.md">English</a> ·
  <a href="./README_zh.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-3.3.1--EE3-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## C'est quoi ?

**Open Cowork** est une application desktop d'agent IA (Electron) pour Windows et macOS. Elle gère vos fichiers, génère des documents via **Skills** (PPTX, DOCX, XLSX, PDF), se connecte à des outils via **MCP**, isole les commandes dans un **sandbox** (WSL2 / Lima), et peut être pilotée à distance via **Feishu** ou **Slack**.

> [!NOTE]
> Ce dépôt est un **fork personnel**. Les releases `EE*` sont des builds **alpha** expérimentales. Pour la version stable officielle, voir [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## Ce que ce fork ajoute

- **12 langues** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — avec localisation backend (erreurs, dialogues)
- **Thème VS Code** — alternative au thème Claude par défaut (Réglages → Apparence)
- **Copier / coller** — menu contextuel et raccourcis natifs sur Windows
- **Toggle sandbox** — activation/désactivation restaurée dans Réglages → Sandbox
- **pi-coding-agent 0.73.1** — migration agent récente + correctifs de compaction du contexte

---

## Installation

### Releases (recommandé)

Téléchargez la dernière version sur la page [Releases](https://github.com/emilien-etadam/open-cowork/releases) :

| Plateforme            | Fichier |
| --------------------- | ------- |
| Windows               | `.exe`  |
| macOS (Apple Silicon) | `.dmg`  |

### Depuis les sources

```bash
git clone https://github.com/emilien-etadam/open-cowork.git
cd open-cowork
npm install   # Node.js 22+
npm run dev
```

Pour construire un installeur local : `npm run build`

---

## Démarrage rapide

1. Ouvrez l'app et allez dans **Réglages** (icône ⚙️ en bas à gauche).
2. Collez votre **clé API** et configurez l'**URL de base** selon votre fournisseur (OpenRouter, Anthropic, GLM, MiniMax, Kimi…).
3. Choisissez un **dossier workspace** — l'agent ne travaillera que dans ce répertoire.
4. Envoyez un prompt, par exemple : _« Lis le fichier rapport.csv et crée un PowerPoint de synthèse en 5 slides. »_

Pour la documentation complète (fournisseurs API, configuration sandbox, skills, MCP), consultez le [README upstream](https://github.com/OpenCoworkAI/open-cowork/blob/main/readme.md).

---

## Licence & crédits

MIT — basé sur [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) par l'équipe upstream.

Maintenu par [Emilien-Etadam](https://github.com/Emilien-Etadam).
