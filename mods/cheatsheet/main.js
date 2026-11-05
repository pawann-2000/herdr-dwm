// Every key on one sheet: Herdr's, the shown layout's and the terminal's from
// keys.json, read live, and the keys mods handle themselves, which they publish
// as shared("cheatsheet.<mod>") = { title, hint, keys: [[keys, what], ...] }.
// Opened as a dialog with mod.open:cheatsheet; type to filter, esc to close.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { keys, shared, theme, props, closeOverlay, window } from "herdr";

const MODS = ["neotree", "sessions", "browser"];
const COL = 360, FONT = 13;

const LABELS = {
  "app.quit": "Quit Herdr", "app.hide": "Hide Herdr", "app.hide_others": "Hide other apps", "app.show_all": "Show all apps",
  "app.palette": "Command palette", "app.settings": "Settings", "app.help": "Herdr's keys dialog",
  "app.zoom_in": "Zoom in", "app.zoom_out": "Zoom out", "app.zoom_reset": "Reset zoom",
  "tab.new": "New tab", "tab.close": "Close tab", "tab.next": "Next tab", "tab.prev": "Previous tab",
  "space.new": "New space", "space.next": "Next space", "space.prev": "Previous space", "space.rename": "Rename space",
  "agent.next": "Next agent", "agent.prev": "Previous agent",
  "layout.switch": "Switch layout", "layout.toggle:sidebar": "Toggle sidebar",
  "pane.close": "Close pane", "pane.zoom": "Zoom pane (monocle)",
  "mod.open:picker": "Space picker", "mod.open:dwm": "dmenu: run a program", "mod.open:cheatsheet": "This cheatsheet", "mod.open:solitaire": "Solitaire (floating)",
  "terminal.search": "Find in terminal", "terminal.copy": "Copy", "terminal.paste": "Paste", "terminal.paste_image": "Paste image",
  "window.close": "Close window", "window.minimize": "Minimize window", "window.maximize": "Maximize window",
  "dwm.spawn": "New terminal (master / stack)", "dwm.togglebar": "Toggle the bar", "dwm.focusnext": "Focus next pane",
  "dwm.focusprev": "Focus previous pane", "dwm.zoom": "Swap with master", "dwm.lastview": "Last tab",
  "dwm.tile": "Tile layout", "dwm.monocle": "Monocle layout",
  "neotree.toggle": "File tree: open / close", "sessions.port": "Open this tab's port in the browser", "sessions.toggle": "Sessions sidebar: open / close",
  terminal: "Pass the key to the program",
};
const SENT = { "\u001bb": "word left", "\u001bf": "word right", "\u0017": "delete word", "\u0001": "line start", "\u0005": "line end", "\u0015": "delete line" };

function label(action) {
  if (LABELS[action]) return LABELS[action];
  // A binding with named arguments: { command, args }.
  if (action.startsWith("{")) {
    try {
      const { command, args = {} } = JSON.parse(action);
      return args.mod === "browser" ? "Browser in a new tab" : args.mod ? `${label(command)}: ${args.mod}` : label(command);
    } catch { return action; }
  }
  const i = action.indexOf(":"), name = i < 0 ? action : action.slice(0, i), arg = i < 0 ? "" : action.slice(i + 1);
  if (name === "send") return `Send ${SENT[arg] ?? JSON.stringify(arg).slice(1, -1)}`;
  if (name === "tab.select") return `Go to tab ${arg}`;
  if (name === "space.select") return `Go to space ${arg}`;
  if (name === "pane.go") return `Focus pane ${arg}`;
  if (name === "pane.swap") return `Swap pane ${arg}`;
  if (name === "pane.split") return `Split ${arg}`;
  if (name === "mod.open") return `Open ${arg}`;
  return `${name.replace(/[._]/g, " ")}${arg ? ` ${arg}` : ""}`;
}

const MAC = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
const OTHER = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super" };
const NAMES = { enter: "↩", backspace: "⌫", escape: "Esc", tab: "⇥", space: "Space", left: "←", right: "→", up: "↑", down: "↓", pageup: "PgUp", pagedown: "PgDn", home: "Home", end: "End" };

// "cmd-shift-] cmd-k" → "⇧⌘] ⌘K" on macOS, "Shift+Super+] Super+K" elsewhere.
function shortcut(text) {
  const mac = window()?.platform === "macos";
  return text.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => ({ secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" })[m.toLowerCase()] ?? m.toLowerCase()));
    const shown = NAMES[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
    const names = mac ? MAC : OTHER;
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), shown].join(mac ? "" : "+");
  }).join(" ");
}

// One row per action, its keys together.
function group(bindings) {
  const rows = new Map();
  for (const b of bindings) {
    const row = rows.get(b.action) ?? { keys: [], what: label(b.action) };
    row.keys.push(shortcut(b.keys));
    rows.set(b.action, row);
  }
  return [...rows.values()].map((r) => ({ keys: r.keys.join("  "), what: r.what }));
}

export default class Cheatsheet extends View {
  init(_p, cx) {
    this.text = ""; this.width = 1000;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  groups() {
    const all = keys(), lay = shared("layout");
    const out = [];
    const add = (title, hint, rows) => { if (rows.length) out.push({ title, hint, rows }); };
    add("Herdr", "everywhere", group(all.filter((b) => b.section === "global")));
    add(`${lay} layout`, "while it shows", group(all.filter((b) => b.section === `layout:${lay}`)));
    add("Terminal", "while a terminal has the keyboard", group(all.filter((b) => b.section === "terminal")));
    for (const section of new Set(all.map((b) => b.section).filter((s) => s.startsWith("mod:")))) {
      add(section.slice(4), "while it has the keyboard", group(all.filter((b) => b.section === section)));
    }
    for (const mod of MODS) {
      const sheet = shared(`cheatsheet.${mod}`);
      if (sheet?.keys) add(sheet.title ?? mod, sheet.hint ?? "", sheet.keys.map(([k, what]) => ({ keys: k, what })));
    }
    return out;
  }

  // Not close(): Herdr calls a view's close() as cleanup.
  dismiss() {
    closeOverlay(props()?.overlay);
  }

  key(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform || m.alt) return;
    if (e.key === "escape") { if (this.text) this.text = ""; else this.dismiss(); }
    else if (e.key === "backspace") this.text = [...this.text].slice(0, -1).join("");
    else if (m.control && e.key === "u") this.text = "";
    else if (e.key === "space") this.text += " ";
    else if (!m.control && e.key_char && [...e.key_char].length === 1) this.text += e.key_char;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme(), q = this.text.toLowerCase().trim();
    const groups = this.groups()
      .map((g) => (!q || g.title.toLowerCase().includes(q) ? g : { ...g, rows: g.rows.filter((r) => `${r.keys} ${r.what}`.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length);

    // Sections in order, each into the shortest column.
    const cols = Array.from({ length: Math.max(1, Math.floor(this.width / COL)) }, () => ({ n: 0, groups: [] }));
    for (const g of groups) {
      const c = cols.reduce((a, b) => (b.n < a.n ? b : a));
      c.groups.push(g);
      c.n += g.rows.length + 3;
    }

    const section = (g) => v_flex().flex_none().gap(1).pb(14)
      .child(h_flex().gap(8).pb(4).items_center().border_b(1).border_color(t.border)
        .child(div().font_bold().text_color(t.foreground).child(g.title))
        .child(div().flex_1().min_w(0).truncate().text_size(FONT - 2).text_color(t.dim).child(g.hint)))
      .children(g.rows.map((r) => h_flex().gap(10).min_h(19).items_center()
        .child(div().flex_none().w(132).truncate().text_color(t.accent_foreground).child(r.keys))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.what))));

    return v_flex().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .size_full().overflow_hidden().bg(t.background).text_color(t.foreground).text_size(FONT)
      .child(h_flex().h(34).flex_none().px(14).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().flex_none().font_bold().child("Cheatsheet"))
        .child(h_flex().flex_1().min_w(0).h(22).px(8).items_center().bg(t.background).border_1().border_color(this.text ? t.accent : t.border)
          .child(div().min_w(0).truncate().text_color(this.text ? t.foreground : t.dim).child(this.text || "type to filter"))
          .when(Boolean(this.text), (el) => el.child(div().flex_none().w(2).h(14).bg(t.foreground))))
        .child(div().flex_none().text_size(FONT - 2).text_color(t.dim).child(`${shortcut("cmd-k k")} or esc closes`)))
      .child(div().id("cheatsheet-body").flex_1().min_h(0).overflow_y_scrollbar().px(16).pt(12)
        .child(groups.length
          ? h_flex().w_full().gap(24).items_start().children(cols.map((c) => v_flex().flex_1().min_w(0).children(c.groups.map(section))))
          : div().text_color(t.dim).child("No key matches")));
  }
}
