#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Installs the OpenCode Usage GNOME Shell extension for the current user.
# Safe to re-run: files are overwritten and the enable step is idempotent.

set -euo pipefail

UUID="open-code-usage@local"
SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"

info() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }

# oc-meters / oc-models need python3.
if ! command -v python3 >/dev/null 2>&1; then
    printf 'error: python3 is required but was not found in PATH\n' >&2
    exit 1
fi

# Warn, but never fail, when the running shell is not declared in metadata.json.
if command -v gnome-shell >/dev/null 2>&1; then
    shell_major="$(gnome-shell --version 2>/dev/null | awk '{print $3}' | cut -d. -f1 || true)"
    if [ -n "${shell_major:-}" ] && ! grep -q "\"${shell_major}\"" "$SRC/metadata.json"; then
        warn "GNOME Shell ${shell_major} is not listed in metadata.json (shell-version)."
        warn "The extension may be shown as incompatible and refuse to enable."
    fi
fi

info "Installing OpenCode Usage Extension ($UUID) ..."

mkdir -p "$EXT_DIR" "$BIN_DIR"
cp -f "$SRC/metadata.json" "$SRC/extension.js" "$SRC/stylesheet.css" "$SRC/oc-mark.svg" "$EXT_DIR/"
install -m 0755 "$SRC/oc-meters" "$SRC/oc-models" "$BIN_DIR/"

# Pre-enable the extension so it is active right after the shell restart.
# `gnome-extensions enable` cannot see a new extension before it is scanned.
python3 - "$UUID" <<'PY' || warn "could not pre-enable; run 'gnome-extensions enable $UUID' after restarting"
import ast
import subprocess
import sys

uuid = sys.argv[1]


def gsettings(*args):
    return subprocess.run(
        ["gsettings", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


try:
    raw = gsettings("get", "org.gnome.shell", "enabled-extensions")
    raw = raw[4:] if raw.startswith("@as ") else raw
    enabled = ast.literal_eval(raw) if raw else []
    if not isinstance(enabled, list):
        enabled = []
    if uuid not in enabled:
        enabled.append(uuid)
        value = "[" + ", ".join("'%s'" % entry for entry in enabled) + "]"
        gsettings("set", "org.gnome.shell", "enabled-extensions", value)
except Exception as error:
    print(f"warning: {error}", file=sys.stderr)
    sys.exit(1)
PY

# Best effort: enables immediately when the extension is already known.
gnome-extensions enable "$UUID" >/dev/null 2>&1 || true

cat <<MSG

Installed.

Restart GNOME Shell to load it:
  X11:     press Alt+F2, type r, press Enter
  Wayland: log out and back in

Verify after the restart:
  gnome-extensions info $UUID

Then click the panel icon and paste your Go API key (oc_sk_...).
It is stored at ~/.config/opencode/zen-key with mode 0600.
MSG
