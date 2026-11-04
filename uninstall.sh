#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Removes the OpenCode Usage GNOME Shell extension from the current user.
# Safe to run more than once.

set -euo pipefail

UUID="open-code-usage@local"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"
KEY_FILE="$CONFIG_HOME/opencode/zen-key"

PURGE_KEY=0

for argument in "$@"; do
    case "$argument" in
        --purge)
            PURGE_KEY=1
            ;;
        -h|--help)
            printf 'Usage: %s [--purge]\n\n' "$(basename "$0")"
            printf '  --purge   also delete the stored API key (%s)\n' "$KEY_FILE"
            exit 0
            ;;
        *)
            printf 'unknown option: %s\n' "$argument" >&2
            exit 2
            ;;
    esac
done

info() { printf '%s\n' "$*"; }

# 1. Unload and remove from enabled-extensions (best effort).
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
fi

# 2. Drop the uuid from both gsettings lists so nothing stale is left behind.
if command -v gsettings >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    python3 - "$UUID" <<'PY' || true
import ast
import subprocess
import sys

uuid = sys.argv[1]


def get_list(key):
    out = subprocess.run(
        ["gsettings", "get", "org.gnome.shell", key],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    out = out[4:] if out.startswith("@as ") else out
    value = ast.literal_eval(out) if out else []
    return value if isinstance(value, list) else []


def set_list(key, values):
    subprocess.run(
        ["gsettings", "set", "org.gnome.shell", key,
         "[" + ", ".join(repr(entry) for entry in values) + "]"],
        check=True, capture_output=True,
    )


for key in ("enabled-extensions", "disabled-extensions"):
    try:
        current = get_list(key)
        if uuid in current:
            set_list(key, [entry for entry in current if entry != uuid])
    except Exception:
        pass
PY
fi

# 3. Remove the extension and its helper scripts.
if [ -d "$EXT_DIR" ]; then
    rm -rf "$EXT_DIR"
    info "Removed $EXT_DIR"
fi

for helper in oc-meters oc-models; do
    if [ -f "$BIN_DIR/$helper" ]; then
        rm -f "$BIN_DIR/$helper"
        info "Removed $BIN_DIR/$helper"
    fi
done

# 4. The stored API key is kept unless --purge was given.
if [ "$PURGE_KEY" -eq 1 ]; then
    if [ -f "$KEY_FILE" ]; then
        rm -f "$KEY_FILE"
        info "Removed stored API key: $KEY_FILE"
    fi
else
    info "Kept stored API key: $KEY_FILE (use --purge to remove)"
fi

info "Uninstalled $UUID."
info "If the panel icon is still visible, restart GNOME Shell:"
info "  X11: Alt+F2, type r, press Enter | Wayland: log out and back in"
