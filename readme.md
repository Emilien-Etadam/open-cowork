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
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
  <img src="https://img.shields.io/badge/version-5.0.0-orange" alt="Version" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
</p>

---

## C'est quoi ?

**Lygodactylus** est une application desktop d'agent IA (Electron) pour Windows et macOS. Elle gère vos fichiers, génère des documents via **Skills** (PPTX, DOCX, XLSX, PDF), installe des extensions via une **marketplace** curated (Skills, MCP, plugins), isole les commandes dans un **sandbox** (WSL2 / Lima), et expose un **chat LAN** (interface web sur le réseau — usage recommandé via tunnel WireGuard).

> [!NOTE]
> Ce dépôt est un **fork personnel**. La série **v5.x** est en **alpha** expérimentale. Les anciennes releases `EE*` restent disponibles mais ne sont plus la branche active. Pour la version stable officielle upstream, voir [OpenCoworkAI/open-cowork](https://github.com/OpenCoworkAI/open-cowork).

---

## Ce que ce fork ajoute

- **12 langues** — fr, en, zh, es, de, it, uk, pl, sv, no, nl, ro — avec localisation backend (erreurs, dialogues)
- **Marketplace unifiée** — Réglages → Extensions : skills, connecteurs MCP et plugins (catalogue curated, 21+ entrées)
- **Chat LAN** — serveur web local pour discuter avec l'agent depuis un navigateur (Réglages → Chat LAN ; recommandé via VPN WireGuard)
- **Commandes slash** — autocomplétion `/` dans le chat, dont les commandes des plugins installés
- **Fork / édition de messages** — nouvelle session depuis un message ou modification du prompt utilisateur
- **Compaction proactive** — compact automatique quand le contexte est presque plein
- **Mises à jour** — auto-update Windows + bouton « Vérifier les mises à jour » (Réglages → Général)
- **Config API simplifiée** — deux profils : OpenAI-compatible et Anthropic-compatible
- **Thème VS Code**, **copier/coller** Windows, **toggle sandbox**, **pi-coding-agent 0.80.2** (`@earendil-works`)

---

## Installation

### Releases (recommandé)

Téléchargez la dernière version sur la page [Releases](https://github.com/emilien-etadam/lygodactylus/releases) :

| Plateforme            | Fichier |
| --------------------- | ------- |
| Windows               | `.exe`  |
| macOS (Apple Silicon) | `.dmg`  |

Sur **Windows**, l'app vérifie les mises à jour au démarrage. Sinon, utilisez **Réglages → Général → Vérifier les mises à jour**.

### Depuis les sources

```bash
git clone https://github.com/emilien-etadam/lygodactylus.git
cd lygodactylus
npm install   # Node.js 22+
npm run dev
```

Pour construire un installeur local : `npm run build`

---

## Démarrage rapide

1. Ouvrez l'app et allez dans **Réglages** (icône ⚙️ en bas à gauche).
2. Configurez un fournisseur **OpenAI-compatible** ou **Anthropic-compatible** (clé API + URL de base).
3. Installez des extensions dans **Réglages → Extensions** (MCP, skills, plugins).
4. Choisissez un **dossier workspace** — l'agent ne travaillera que dans ce répertoire.
5. Envoyez un prompt, tapez `/` pour les commandes slash, ou activez le **Chat LAN** pour accéder au chat via le navigateur (de préférence via un tunnel WireGuard).

Pour le détail des releases, voir [`CHANGELOG.md`](CHANGELOG.md).

---

## Licence & crédits

MIT — basé sur [Open Cowork](https://github.com/OpenCoworkAI/open-cowork) par l'équipe upstream.

Maintenu par [Emilien-Etadam](https://github.com/Emilien-Etadam).
