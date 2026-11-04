# OpenCode Usage Extension

An unofficial GNOME Shell extension that shows your
[OpenCode Go](https://opencode.ai/console/go) subscription usage directly in
the top bar — limits, reset countdowns, and a per-model breakdown, without
opening a browser tab.

![GNOME Shell 46](https://img.shields.io/badge/GNOME%20Shell-46-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Made with GJS](https://img.shields.io/badge/made%20with-GJS-orange)

---

## What this is

OpenCode Go subscriptions are metered in three windows:

| Window | Meaning |
| --- | --- |
| **Rolling 5h** | usage in the last 5 hours, resets continuously |
| **Weekly** | usage for the current week |
| **Monthly** | usage for the current billing period |

The only place to see those numbers is the OpenCode Console in a browser. This
extension puts them one click away, in the GNOME panel, and keeps them fresh
while you work.

It is a thin UI: the panel shows the rolling 5-hour percentage, the popup shows
all three meters, and hovering the models icon expands a per-model breakdown
(share of spend, request count, input/output/cache tokens) for the last 5 hours,
24 hours, or 7 days.

## Why use it

- **No context switching.** Glance at the panel instead of opening the console.
- **Catch limits early.** The 5-hour window resets quickly; a permanent label
  makes it obvious when you are close to the cap.
- **Know where the spend goes.** The per-model breakdown shows which model is
  consuming your allowance.
- **Honest state.** If the API cannot be reached, the popup goes fully grey and
  never shows stale numbers.

## Features

- **Rolling 5h / Weekly / Monthly** limits — each with an animated progress bar,
  percentage, and a "resets in …" countdown.
- **Per-model breakdown** — share of spend, request and token counts — on hover.
- Minimal black popup, subtle open animation, 30 s auto-refresh.
- Bar colours escalate: neutral → **amber at ≥ 70%** → **red at ≥ 90%**.
- Grey "unavailable" state when the API is unreachable (never stale numbers).
- Manual refresh button.
- **First-run prompt** asks once for your Go API key and stores it locally (0600).

## Privacy

- The extension talks only to `opencode.ai` and `console.opencode.ai`.
- Your API key is stored locally at `~/.config/opencode/zen-key` (mode `0600`),
  or read from `OC_API_KEY`. It is never sent anywhere except those two hosts.
- No telemetry, analytics, tracking, or third-party requests.
- No clipboard access.

## Disclaimer

This is an unofficial project and is not affiliated with or endorsed by
OpenCode. "OpenCode" and its logo belong to their respective owners.

---

## Requirements

| What | Version / note |
| --- | --- |
| GNOME Shell | **46** (other versions untested) |
| Python | 3.8+ (stdlib only, no pip / no `opencode` CLI) |
| Network | reach `opencode.ai` and `console.opencode.ai` |
| Subscription | OpenCode **Go** or **Go Plus** API key (`oc_sk_…`) |

Get the key: [OpenCode Console → Go](https://opencode.ai/console/go).

---

## Installation

### Quick install (recommended)

```bash
cd opencode-linux-extension
./install.sh
```

Then restart the shell so GNOME discovers the new extension:

```bash
# X11
Alt+F2  →  type "r"  →  Enter

# Wayland: log out and log back in
```

### Manual install

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/open-code-usage@local
cp metadata.json extension.js stylesheet.css oc-mark.svg \
   ~/.local/share/gnome-shell/extensions/open-code-usage@local/

mkdir -p ~/.local/bin
install -m 0755 oc-meters oc-models ~/.local/bin/

gnome-extensions enable open-code-usage@local
```

Restart the shell (same as above).

### Enable / verify

```bash
gnome-extensions enable open-code-usage@local
gnome-extensions info open-code-usage@local        # expect: Enabled: Yes, State: ACTIVE
```

---

## First run

1. Click the **OpenCode icon** in the top bar.
2. Paste your Go API key (`oc_sk_…`) into the field (masked).
3. Click **Save**.

The key is stored at:

```
~/.config/opencode/zen-key      (permissions 0600)
```

To use an environment variable instead of a file:

```bash
export OC_API_KEY=oc_sk_…
```

---

## Usage

| Action | Result |
| --- | --- |
| Click the icon | open / close the limits popup |
| Hover the grid icon (top-right) | show per-model details |
| `5h / 24h / 7d` switch | change the models window |
| Click ↻ | force refresh (skips the 15 s cache) |
| `Esc` or click outside | close |

Bar colours: neutral → **amber at ≥ 70%** → **red at ≥ 90%**.
The panel label always shows the **rolling 5-hour** percentage.

---

## How it works

Two read-only HTTPS endpoints, polled every 30 s while running (no websocket,
no cookie):

```
GET https://opencode.ai/zen/go/v1/usage          # rolling / weekly / monthly %
GET https://console.opencode.ai/api/usage/models # per-model tokens & cost
```

`oc-meters` and `oc-models` are small Python helpers (stdlib `urllib` only).
They can be run independently to test the data path:

```bash
oc-meters                     # 5h / weekly / monthly as text
oc-meters --json              # raw JSON
oc-models --window 24h --json # per-model, machine-readable
oc-models --window 7d --top 5
```

---

## Files

```
OpenCode-Usage-Extension/
├── install.sh          # one-command installer
├── README.md           # this file
├── LICENSE             # MIT
├── metadata.json       # GNOME manifest (uuid open-code-usage@local)
├── extension.js        # GJS source (GNOME 46, ESM)
├── stylesheet.css      # minimal black theme
├── oc-mark.svg         # panel icon (OpenCode mark)
├── oc-meters           # limits fetcher
└── oc-models           # per-model fetcher
```

---

## Uninstall

```bash
rm -rf ~/.local/share/gnome-shell/extensions/open-code-usage@local
rm -f  ~/.local/bin/oc-meters ~/.local/bin/oc-models
rm -f  ~/.config/opencode/zen-key   # remove your stored key
```

Restart the shell (`Alt+F2` → `r`).

---

## Troubleshooting

```bash
gnome-extensions info open-code-usage@local
journalctl --user -b --no-pager | grep "open-code-usage@"
```

Test the data path without the shell:

```bash
curl -s https://opencode.ai/zen/go/v1/usage \
  -H "Authorization: Bearer $(cat ~/.config/opencode/zen-key)"
```

- `State: ERROR` → a code error; read the journal line.
- Grey bars → fetch failed (missing/invalid key, or no network).
