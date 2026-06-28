#!/usr/bin/env bash
#
# install-linux-desktop.sh — Integrate Lygodactylus AppImage into the Linux
# application launcher (XDG desktop entry).
#
# Adapted from OpenCoworkAI/open-cowork PR #264.
#
# Usage:
#   ./scripts/install-linux-desktop.sh [APPDIR]
#
#   APPDIR defaults to ./release. The script looks for the first
#   Lygodactylus-*-linux-*.AppImage in that directory.
#
# What it does:
#   1. Copies the AppImage to ~/.local/bin/lygodactylus
#   2. Installs the application icon to ~/.local/share/icons/hicolor/
#   3. Creates a .desktop entry in ~/.local/share/applications/
#   4. Updates the desktop database so the launcher picks it up immediately
#
# After running, press Super and search for "Lygodactylus".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APPDIR="${1:-$PROJECT_ROOT/release}"

# ── Locate AppImage ──────────────────────────────────────────────────────────
APPIMAGE=""
if [ -d "$APPDIR" ]; then
  APPIMAGE=$(find "$APPDIR" -maxdepth 1 -name 'Lygodactylus-*-linux-*.AppImage' -print -quit 2>/dev/null || true)
fi

if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "ERROR: No AppImage found in $APPDIR"
  echo "Build it first:  npm run build:linux"
  echo "Or pass a custom path:  $0 /path/to/release"
  exit 1
fi

echo "Found: $(basename "$APPIMAGE")"

# ── Directories ──────────────────────────────────────────────────────────────
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
DESKTOP_DIR="$HOME/.local/share/applications"

mkdir -p "$BIN_DIR" "$ICON_DIR" "$DESKTOP_DIR"

# ── 1. Install AppImage ─────────────────────────────────────────────────────
APPIMAGE_DEST="$BIN_DIR/lygodactylus"
echo "→ Installing AppImage to $APPIMAGE_DEST"
cp "$APPIMAGE" "$APPIMAGE_DEST"
chmod +x "$APPIMAGE_DEST"

# ── 2. Install icon ─────────────────────────────────────────────────────────
ICON_SRC="$PROJECT_ROOT/resources/icon.png"
ICON_DEST="$ICON_DIR/lygodactylus.png"

if [ -f "$ICON_SRC" ]; then
  echo "→ Installing icon from resources/icon.png"
  cp "$ICON_SRC" "$ICON_DEST"
else
  echo "→ Extracting icon from AppImage"
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  cd "$TMPDIR"
  "$APPIMAGE" --appimage-extract 2>/dev/null || true
  ICON_CANDIDATE=$(find squashfs-root -name '*.png' -path '*/icons/*' 2>/dev/null | head -1 || true)
  if [ -n "$ICON_CANDIDATE" ] && [ -f "$ICON_CANDIDATE" ]; then
    cp "$ICON_CANDIDATE" "$ICON_DEST"
  else
    echo "WARNING: Could not extract icon from AppImage — desktop entry will have no icon."
  fi
  cd "$PROJECT_ROOT"
fi

# ── 3. Create .desktop entry ────────────────────────────────────────────────
DESKTOP_FILE="$DESKTOP_DIR/lygodactylus.desktop"
echo "→ Creating desktop entry: $DESKTOP_FILE"

cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Lygodactylus
Comment=Open-source AI agent desktop app — Claude Code, MCP tools, and Skills
Exec=$APPIMAGE_DEST %U
Icon=lygodactylus
Type=Application
Categories=Development;Utility;
Terminal=false
StartupWMClass=Lygodactylus
EOF

# ── 4. Update desktop database ──────────────────────────────────────────────
if command -v update-desktop-database &>/dev/null; then
  echo "→ Updating desktop database"
  update-desktop-database "$DESKTOP_DIR"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Lygodactylus installed to application launcher."
echo "   Press Super and search for \"Lygodactylus\"."
echo ""
echo "   AppImage:  $APPIMAGE_DEST"
echo "   Desktop:   $DESKTOP_FILE"
echo "   Icon:      $ICON_DEST"
echo ""
echo "   To uninstall, delete those three files."
