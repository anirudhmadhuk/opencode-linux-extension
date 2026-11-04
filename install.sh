#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/open-code-usage@local"
BIN_DIR="$HOME/.local/bin"

echo "Installing OpenCode Usage Extension (open-code-usage@local) ..."

mkdir -p "$EXT_DIR" "$BIN_DIR"

cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/stylesheet.css" "$SRC/oc-mark.svg" "$EXT_DIR/"
install -m 0755 "$SRC/oc-meters" "$SRC/oc-models" "$BIN_DIR/"

# Enable if a running shell can see it; a restart is still required on first install.
gnome-extensions enable open-code-usage@local 2>/dev/null || true

cat <<'MSG'
Done. Installed to:
  ~/.local/share/gnome-shell/extensions/open-code-usage@local
  ~/.local/bin/oc-meters, ~/.local/bin/oc-models

Restart GNOME Shell so the extension is discovered:
  X11:     press Alt+F2, type r, press Enter
  Wayland: log out and back in

Then click the OpenCode icon in the top bar and paste your Go API key
(oc_sk_...) when prompted. It is stored at:
  ~/.config/opencode/zen-key   (mode 0600)
MSG
