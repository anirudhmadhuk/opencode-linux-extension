import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const POLL_SECONDS = 30;
const POPUP_W = 300;
const MODELS_W = 320;

const LIMITS = [
    { key: 'rolling', label: 'Rolling 5h' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
];

function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
}

function resetsIn(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '—';
    let s = Math.floor((t - Date.now()) / 1000);
    if (s <= 0) return 'now';
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
}

export default class OcGoExtension extends Extension {
    enable() {
        this._home = GLib.get_home_dir();
        this._iconPath = `${this.path}/oc-mark.svg`;
        this._open = false;
        this._modelsOpen = false;
        this._modelsWindow = '5h';
        this._hideTimer = 0;
        this._stageKeyId = 0;

        this._buildPanel();
        this._buildDismiss();
        this._buildPopup();
        this._buildModels();

        this._refresh(true);
        this._poll = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, POLL_SECONDS,
            () => { this._refresh(false); return GLib.SOURCE_CONTINUE; }
        );
    }

    disable() {
        if (this._poll) { GLib.source_remove(this._poll); this._poll = 0; }
        this._clearHideTimer();
        if (this._stageKeyId) { global.stage.disconnect(this._stageKeyId); this._stageKeyId = 0; }
        this._popup?.destroy(); this._popup = null;
        this._models?.destroy(); this._models = null;
        this._dismiss?.destroy(); this._dismiss = null;
        this._button?.destroy(); this._button = null;
    }

    // ---- panel -------------------------------------------------------------

    _buildPanel() {
        const icon = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(this._iconPath)),
            style_class: 'system-status-icon oc-mark',
        });
        icon.set_icon_size(16);
        this._panelLabel = new St.Label({ text: '—', y_align: Clutter.ActorAlign.CENTER });

        const box = new St.BoxLayout({ vertical: false });
        box.add_child(icon);
        box.add_child(this._panelLabel);

        this._button = new PanelMenu.Button(0.5, '', true);
        this._button.add_child(box);
        this._button.connect('button-release-event', (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this._toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.panel.addToStatusArea(this.uuid, this._button);
    }

    _buildDismiss() {
        this._dismiss = new St.Widget({ reactive: true, style_class: 'oc-dismiss' });
        this._dismiss.hide();
        this._dismiss.connect('button-press-event', () => { this._close(); return Clutter.EVENT_STOP; });
        Main.layoutManager.addTopChrome(this._dismiss);
    }

    _sizeDismiss() {
        const m = Main.layoutManager.primaryMonitor;
        const [, by] = this._button.get_transformed_position();
        const py2 = by + this._button.get_height();
        this._dismiss.set_position(m.x, py2);
        this._dismiss.set_size(m.width, Math.max(0, m.y + m.height - py2));
    }

    // ---- popup (limits) ----------------------------------------------------

    _buildPopup() {
        this._popup = new St.BoxLayout({
            vertical: true,
            width: POPUP_W,
            style_class: 'oc-popup',
            reactive: true,
        });

        const header = new St.BoxLayout({ vertical: false });
        const title = new St.Label({ text: 'OpenCode Go', style_class: 'oc-title', x_expand: true, x_align: Clutter.ActorAlign.START });
        this._modelsBtn = this._makeHeaderIcon('view-grid-symbolic', 'Models');
        this._refreshBtn = this._makeHeaderIcon('view-refresh-symbolic', 'Refresh');
        header.add_child(title);
        header.add_child(this._modelsBtn);
        header.add_child(this._refreshBtn);
        this._popup.add_child(header);

        this._rows = {};
        this._rowsBox = new St.BoxLayout({ vertical: true });
        for (const l of LIMITS) {
            this._rowsBox.add_child(this._buildLimitRow(l));
        }
        this._popup.add_child(this._rowsBox);

        // first-run API key prompt
        const keyRow = new St.BoxLayout({ vertical: true, style_class: 'oc-keyrow' });
        keyRow.add_child(new St.Label({ text: 'Enter your OpenCode Go API key', style_class: 'oc-row-label' }));
        this._keyEntry = new St.Entry({ style_class: 'oc-key-entry', hint_text: 'oc_sk_…', can_focus: true, reactive: true, text: '' });
        this._keyEntry.clutter_text.set_password_char('•');
        this._keySave = new St.Button({ label: 'Save', style_class: 'oc-key-btn', can_focus: true, reactive: true });
        this._keySave.connect('clicked', () => this._saveKey());
        keyRow.add_child(this._keyEntry);
        keyRow.add_child(this._keySave);
        this._keyPrompt = keyRow;
        this._popup.add_child(this._keyPrompt);
        this._keyPrompt.hide();

        this._modelsBtn.connect('enter-event', () => { this._showModels(); return Clutter.EVENT_PROPAGATE; });
        this._modelsBtn.connect('leave-event', () => { this._scheduleHideModels(); return Clutter.EVENT_PROPAGATE; });
        this._refreshBtn.connect('clicked', () => { this._spin(this._refreshBtn); this._refresh(true); });

        this._popup.hide();
        Main.layoutManager.addTopChrome(this._popup);
    }

    _makeHeaderIcon(name, tip) {
        const icon = new St.Icon({
            icon_name: name,
            style_class: 'system-status-icon oc-hicon',
        });
        icon.set_icon_size(16);
        const btn = new St.Button({
            child: icon,
            can_focus: false,
            reactive: true,
            track_hover: true,
            style_class: 'oc-icon-btn',
        });
        return btn;
    }

    _buildLimitRow(l) {
        const top = new St.BoxLayout({ vertical: false });
        const name = new St.Label({ text: l.label, style_class: 'oc-row-label', x_expand: true, x_align: Clutter.ActorAlign.START });
        const pct = new St.Label({ text: '—', style_class: 'oc-pct' });
        top.add_child(name);
        top.add_child(pct);

        const sub = new St.Label({ text: 'resets in —', style_class: 'oc-sub' });

        const fill = new St.Widget({ style_class: 'oc-fill', width: 0, height: 6 });
        const bar = new St.Widget({ style_class: 'oc-bar', width: POPUP_W - 28, height: 6 });
        bar.add_child(fill);

        const box = new St.BoxLayout({ vertical: true, style_class: 'oc-row' });
        box.add_child(top);
        box.add_child(bar);
        box.add_child(sub);

        this._rows[l.key] = { pct, sub, fill, bar };
        return box;
    }

    // ---- models panel ------------------------------------------------------

    _buildModels() {
        this._models = new St.BoxLayout({
            vertical: true,
            width: MODELS_W,
            style_class: 'oc-popup oc-models',
            reactive: true,
        });

        const header = new St.BoxLayout({ vertical: false });
        const title = new St.Label({ text: 'Models', style_class: 'oc-title', x_expand: true, x_align: Clutter.ActorAlign.START });
        header.add_child(title);
        this._models.add_child(header);

        const seg = new St.BoxLayout({ vertical: false, style_class: 'oc-seg' });
        this._segBtns = {};
        for (const w of ['5h', '24h', '7d']) {
            const b = new St.Button({ label: w, can_focus: false, reactive: true, style_class: 'oc-seg-btn' });
            b.connect('clicked', () => { this._modelsWindow = w; this._styleSeg(); this._refreshModels(); });
            this._segBtns[w] = b;
            seg.add_child(b);
        }
        this._models.add_child(seg);
        this._styleSeg();

        this._modelsList = new St.BoxLayout({ vertical: true });
        this._models.add_child(this._modelsList);

        this._models.connect('enter-event', () => { this._clearHideTimer(); return Clutter.EVENT_PROPAGATE; });
        this._models.connect('leave-event', () => { this._scheduleHideModels(); return Clutter.EVENT_PROPAGATE; });

        this._models.hide();
        Main.layoutManager.addTopChrome(this._models);
    }

    _styleSeg() {
        for (const [w, b] of Object.entries(this._segBtns)) {
            if (w === this._modelsWindow) b.add_style_class_name('oc-seg-active');
            else b.remove_style_class_name('oc-seg-active');
        }
    }

    _renderModels(items, error) {
        this._modelsList.destroy_all_children();
        this._models.remove_style_class_name('oc-error');

        if (error || !items || !items.length) {
            this._models.add_style_class_name('oc-error');
            const empty = new St.Label({ text: 'unavailable', style_class: 'oc-empty' });
            this._modelsList.add_child(empty);
            return;
        }

        const total = items.reduce((a, i) => a + Number(i.totalCostMicroCents || 0), 0);
        for (const i of items) {
            const cost = Number(i.totalCostMicroCents || 0);
            const share = total > 0 ? cost / total * 100 : 0;

            const top = new St.BoxLayout({ vertical: false });
            const name = new St.Label({ text: i.model, style_class: 'oc-mname', x_expand: true, x_align: Clutter.ActorAlign.START });
            const pct = new St.Label({ text: `${share.toFixed(1)}%`, style_class: 'oc-mshare' });
            top.add_child(name);
            top.add_child(pct);

            const fill = new St.Widget({ style_class: 'oc-fill', width: 0, height: 4 });
            const bar = new St.Widget({ style_class: 'oc-bar oc-thin', width: MODELS_W - 28, height: 4 });
            bar.add_child(fill);

            const toks = new St.Label({
                text: `${fmt(i.totalRequests)} req · ${fmt(i.totalInputTokens)} in · ${fmt(i.totalOutputTokens)} out · ${fmt(i.totalCacheReadTokens)} cache`,
                style_class: 'oc-sub',
            });

            const row = new St.BoxLayout({ vertical: true, style_class: 'oc-row oc-mrow' });
            row.add_child(top);
            row.add_child(bar);
            row.add_child(toks);
            this._modelsList.add_child(row);

            fill.ease({ width: Math.round(share / 100 * (MODELS_W - 28)), duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    // ---- show / hide -------------------------------------------------------

    _toggle() { this._open ? this._close() : this._openPopup(); }

    _openPopup() {
        if (this._open) return;
        this._open = true;
        this._sizeDismiss();
        this._dismiss.show();
        this._position(this._popup, POPUP_W);
        this._animateIn(this._popup);
        this._stageKeyId = global.stage.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) { this._close(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
        this._refresh(true);
    }

    _close() {
        if (!this._open) return;
        this._open = false;
        this._hideModels();
        if (this._stageKeyId) { global.stage.disconnect(this._stageKeyId); this._stageKeyId = 0; }
        this._animateOut(this._popup, () => this._dismiss.hide());
    }

    _position(actor, w) {
        const m = Main.layoutManager.primaryMonitor;
        const [bx, by] = this._button.get_transformed_position();
        const bw = this._button.get_width();
        let x = Math.round(bx + bw / 2 - w / 2);
        x = Math.max(m.x + 8, Math.min(x, m.x + m.width - w - 8));
        actor.set_position(x, by + this._button.get_height() + 6);
    }

    _showModels() {
        if (!this._open || this._modelsOpen) return;
        this._modelsOpen = true;
        this._clearHideTimer();
        const [px, py] = this._popup.get_position();
        const m = Main.layoutManager.primaryMonitor;
        let x = px + POPUP_W + 8;
        if (x + MODELS_W > m.x + m.width - 8) x = px - MODELS_W - 8;
        this._models.set_position(Math.max(m.x + 8, x), py);
        this._animateIn(this._models);
        this._refreshModels();
    }

    _scheduleHideModels() {
        this._clearHideTimer();
        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => { this._hideModels(); return GLib.SOURCE_REMOVE; });
    }

    _hideModels() {
        this._clearHideTimer();
        if (!this._modelsOpen) return;
        this._modelsOpen = false;
        this._animateOut(this._models);
    }

    _clearHideTimer() {
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = 0; }
    }

    // ---- animation ---------------------------------------------------------

    _animateIn(actor) {
        actor.show();
        actor.opacity = 0;
        actor.scale_x = 0.96;
        actor.scale_y = 0.96;
        actor.pivot_point = new Graphene.Point({ x: 0.5, y: 0 });
        actor.ease({
            opacity: 255, scale_x: 1, scale_y: 1,
            duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _animateOut(actor, cb) {
        actor.ease({
            opacity: 0, scale_x: 0.96, scale_y: 0.96,
            duration: 120, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { actor.hide(); if (cb) cb(); },
        });
    }

    _spin(btn) {
        const icon = btn.get_child();
        icon.ease({
            rotation_angle_z: 360,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => icon.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, 0),
        });
    }

    // ---- data --------------------------------------------------------------

    _spawn(cmd, cb) {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                cmd, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) { cb(null); return; }
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                // Accept output regardless of exit code: oc-meters exits 3 at 100%.
                cb(out && out.trim() ? out : null);
            } catch (e) { cb(null); }
        });
    }

    _refresh(force) {
        this._refreshLimits(force);
        if (this._modelsOpen) this._refreshModels();
        else if (this._open) this._refreshModels();
    }

    _refreshLimits(force) {
        if (this._needsKey()) {
            this._showKeyPrompt();
            this._panelLabel.text = '—';
            return;
        }
        this._hideKeyPrompt();
        const args = [`${this._home}/.local/bin/oc-meters`, '--json'];
        if (force) args.push('--no-cache');
        this._spawn(args, out => {
            let usage = null;
            if (out) {
                try { usage = JSON.parse(out); } catch (e) { /* ignore */ }
            }
            this._renderLimits(usage);
        });
    }

    _needsKey() {
        if (GLib.getenv('OC_API_KEY'))
            return false;
        const f = Gio.File.new_for_path(`${this._home}/.config/opencode/zen-key`);
        if (!f.query_exists(null))
            return true;
        try {
            const [, contents] = f.load_contents(null);
            return !new TextDecoder('utf-8').decode(contents).trim();
        } catch (e) { return true; }
    }

    _showKeyPrompt() {
        if (this._rowsBox) this._rowsBox.hide();
        if (this._keyPrompt) this._keyPrompt.show();
    }

    _hideKeyPrompt() {
        if (this._keyPrompt) this._keyPrompt.hide();
        if (this._rowsBox) this._rowsBox.show();
    }

    _saveKey() {
        const key = this._keyEntry.get_text().trim();
        if (!key) return;
        try {
            const dir = Gio.File.new_for_path(`${this._home}/.config/opencode`);
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
            const f = Gio.File.new_for_path(`${this._home}/.config/opencode/zen-key`);
            f.replace_contents(`${key}\n`, null, false, Gio.FileCreateFlags.PRIVATE, null, null);
        } catch (e) {
            log(`open-code-usage: failed to save key: ${e.message}`);
            return;
        }
        this._keyEntry.set_text('');
        this._hideKeyPrompt();
        this._refresh(true);
    }

    _renderLimits(usage) {
        const err = !usage;
        this._popup.remove_style_class_name('oc-error');
        if (err) this._popup.add_style_class_name('oc-error');

        for (const l of LIMITS) {
            const row = this._rows[l.key];
            const v = usage ? usage[l.key] : null;
            const p = v && typeof v.percent === 'number' ? v.percent : null;

            row.pct.text = p === null ? '—' : `${p}%`;
            row.sub.text = `resets in ${resetsIn(v && v.resetsAt)}`;
            row.fill.remove_style_class_name('oc-fill-warn');
            row.fill.remove_style_class_name('oc-fill-danger');

            if (p === null) {
                row.fill.ease({ width: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            } else {
                if (p >= 90) row.fill.add_style_class_name('oc-fill-danger');
                else if (p >= 70) row.fill.add_style_class_name('oc-fill-warn');
                row.fill.ease({
                    width: Math.round(p / 100 * (POPUP_W - 28)),
                    duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }

        const rolling = usage ? usage.rolling : null;
        const p = rolling && typeof rolling.percent === 'number' ? rolling.percent : null;
        this._panelLabel.text = p === null ? '—' : `${p}%`;
    }

    _refreshModels() {
        const args = [`${this._home}/.local/bin/oc-models`, '--window', this._modelsWindow, '--top', '5', '--json'];
        this._spawn(args, out => {
            let items = null;
            if (out) {
                try { items = JSON.parse(out).items; } catch (e) { /* ignore */ }
            }
            this._renderModels(items, !out);
        });
    }
}
