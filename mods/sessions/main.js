// Sessions and agents for the dwm layout, drawn like the neotree mod: spaces by
// machine with their tabs, every agent by urgency with its sub-agents, and live
// core terminals no space shows. Keys follow the file tree's (? lists them).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { spaces, machines, panes, agents, terminals, exec, hc, knownAgents, run, notify, theme, props, shared, setShared, setAgentOrder, nextCommand } from "herdr";
import { listening, rootPid, forward, tunnels, EPHEMERAL, LABEL } from "./ports.js";

const ROW = 20, HEAD = 28, IND = 16, PAD = 6, FONT = 13, WIDTH = 260;
const ICON_FONT = "Symbols Nerd Font";
const G = { web: "\u{F059F}", open: "", closed: "", local: "", remote: "\u{F048B}", branch: "", term: "", pin: "\u{F0403}", blocked: "", done: "", idle: "" };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// The new-menu mod's cache of each machine's agents, shown while knownAgents() asks again.
const KNOWN = "new-menu.agents";
// Node's debugger listens beside dev servers; it isn't a page.
const NOT_PAGES = new Set([9229]);
const OPEN = 'case "$(uname)" in Darwin) open "$1";; *) xdg-open "$1" >/dev/null 2>&1 & ;; esac';
const COPY = 'printf %s "$1" | { pbcopy 2>/dev/null || wl-copy 2>/dev/null || xclip -selection clipboard; }';
const NAMED = new Set(["enter", "escape", "backspace", "tab", "space", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"]);

const HELP = [
  ["j k", "down / up"], ["gg G", "top / bottom"], ["enter o", "go there"],
  ["space", "fold, or show it and stay here"], ["l h", "expand / collapse"],
  ["a", "new space on that machine"], ["t", "new terminal tab"], ["n", "new agent tab"],
  ["r", "rename space / tab"], ["d", "close space / tab, kill terminal"],
  ["J K", "move space / tab down / up"], ["p", "peek at a terminal"],
  ["P", "pin / unpin agent"], ["T", "give a terminal its own tab"],
  ["enter (port)", "open it in the browser"], ["O (port)", "open it in the system browser"], ["y (port)", "copy its address"],
  ["q", "close"], ["esc", "back to the terminal"],
];

const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Each tab's lead pane: its first agent, else its focused terminal, else its first.
function leads(all) {
  const out = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const cur = out.get(p.tab);
    if (!cur || (!cur.program?.agent && (p.program?.agent || (!cur.focused && p.focused)))) out.set(p.tab, p);
  }
  return out;
}

const tabLabel = (tab, lead) => (tab.named ? tab.name : lead?.program?.name || clean(lead?.title) || tab.name);

// A sub-agent's raw word; error counts as blocked, and done is its parent's news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

export default class Sessions extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    try { this.fold = JSON.parse(store("fold") ?? "{}"); } catch { this.fold = {}; }
    this.cursor = null; this.at = 0; this.width = WIDTH; this.height = 0;
    this.restore = Number(store("width")) > 40 ? Number(store("width")) : WIDTH;
    this.prompt = null; this.help = false; this.pending = null; this.host = null;
    setShared("cheatsheet.sessions", { title: "Sessions sidebar", hint: "alt-s, then these", keys: HELP });
    cx.spawn(async (cx) => {
      const r = await exec("hostname", ["-s"]).catch(() => null);
      this.host = r?.code === 0 ? r.stdout.trim() : null;
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand());
        cx.notify();
      }
    });
    // Durations are in minutes; the rest is live data.
    cx.timer.every(30000, (cx) => cx.notify());
    this.ports = []; this.portSeen = null; this.scanning = false;
    cx.timer.after(1500, (cx) => this.scanPorts(cx));
    cx.timer.every(5000, (cx) => this.scanPorts(cx));
  }

  command(c) {
    const shut = this.width < 8;
    if (c === "focus") {
      if (shut) this.expand();
      this.handle.focus();
    } else if (c === "port") {
      const tab = spaces().find((x) => x.active)?.tabs.find((x) => x.active);
      const f = this.ports.find((x) => x.tab === tab?.id) ?? this.ports.at(-1);
      if (f) this.openPort(f);
      else notify({ title: "No ports", body: "Nothing in your terminals is listening on a port yet.", level: "info" });
    } else if (c === "toggle") {
      if (shut) { this.expand(); this.handle.focus(); }
      else if (this.handle.is_focused()) this.hide();
      else this.handle.focus();
    }
  }

  isOpen(key, otherwise) {
    return this.fold[key] ?? otherwise;
  }

  setOpen(key, open) {
    this.fold[key] = open;
    store("fold", JSON.stringify(this.fold));
    return true;
  }

  rows() {
    const sp = spaces(), ms = machines(), all = terminals(), ps = panes(), lead = leads(ps), out = [];
    const tabs = new Map(sp.flatMap((s) => s.tabs.map((tab) => [tab.id, { s, tab }])));
    const names = [];
    for (const n of [null, ...sp.map((s) => s.machine ?? null), ...ms.map((m) => m.name)]) if (!names.includes(n)) names.push(n);
    for (const m of names) {
      const mine = sp.filter((s) => (s.machine ?? null) === m), key = `m:${m ?? ""}`, open = this.isOpen(key, true);
      out.push({ kind: "machine", key, m, open, count: mine.length, state: ms.find((x) => x.name === m)?.layout });
      if (!open) continue;
      for (const s of mine) {
        const skey = `s:${s.id}`, sopen = this.isOpen(skey, s.active);
        out.push({ kind: "space", key: skey, s, m, open: sopen, ports: this.ports.filter((f) => s.tabs.some((tab) => tab.id === f.tab)) });
        if (sopen) s.tabs.forEach((tab, i) => {
          const last = i === s.tabs.length - 1, mine = this.ports.filter((f) => f.tab === tab.id);
          out.push({ kind: "tab", key: `t:${tab.id}`, s, tab, m, lead: lead.get(tab.id), lasts: [last] });
          mine.forEach((f, j) => out.push({ kind: "port", key: `p:${f.key}`, s, m, f, lasts: [last, j === mine.length - 1] }));
        });
      }
    }

    const list = [...agents()].sort((x, y) => Number(y.pinned) - Number(x.pinned) || (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
    const listed = new Map(list.map((a) => [a.address, a.status]));
    this.order = list.map((a) => a.address);
    const akey = "h:agents", aopen = this.isOpen(akey, true);
    out.push({ kind: "head", key: akey, label: "Agents", count: list.length, open: aopen, blocked: list.filter((a) => a.status === "blocked").length });
    if (aopen) for (const a of list) {
      out.push({ kind: "agent", key: `a:${a.address}`, a, where: tabs.get(a.tab), m: a.address.includes("/") ? a.address.split("/")[0] : null });
      this.kids(all, listed, a.address, [], out);
    }

    const shown = new Set(ps.map((p) => p.terminal).filter(Boolean));
    const loose = all.filter((t) => t.state === "live" && !t.parent && !t.labels?.["herdr.space"] && !t.labels?.[LABEL] && !shown.has(t.address));
    if (loose.length) {
      const lkey = "h:loose", lopen = this.isOpen(lkey, true);
      out.push({ kind: "head", key: lkey, label: "Detached", count: loose.length, open: lopen, blocked: 0 });
      if (lopen) for (const t of loose) out.push({ kind: "loose", key: `l:${t.address}`, t, status: kidStatus(t, listed) });
    }
    return out;
  }

  // Live sub-agents of addr, depth first; lasts says which levels end on each row.
  kids(all, listed, addr, lasts, out) {
    if (lasts.length > 8) return;
    const ks = all.filter((k) => k.parent === addr && k.state === "live");
    ks.forEach((k, i) => {
      const l = [...lasts, i === ks.length - 1];
      out.push({ kind: "sub", key: `k:${k.address}`, t: k, lasts: l, status: kidStatus(k, listed) });
      this.kids(all, listed, k.address, l, out);
    });
  }

  // Where the cursor rests while the sidebar isn't in use: the shown tab.
  current(rows) {
    const s = spaces().find((x) => x.active), tab = s?.tabs.find((x) => x.active);
    return [`t:${tab?.id}`, `s:${s?.id}`].find((k) => rows.some((r) => r.key === k)) ?? null;
  }

  // The file tree's indent markers: │ while a level has more below, └ on its last row.
  guides(lasts, t) {
    const x = IND / 2 - 1;
    return lasts.map((last, c) => {
      const own = c === lasts.length - 1, cell = div().flex_none().w(IND).h(ROW).relative();
      return own || !last
        ? cell.child(div().absolute().left(x).top(0).w(1).h(own && last ? ROW / 2 : ROW).bg(t.border))
          .when(own && last, (el) => el.child(div().absolute().left(x).top(ROW / 2).w(IND / 2).h(1).bg(t.border)))
        : cell;
    });
  }

  glyph(g, color, size = FONT) {
    return div().flex_none().w(IND).flex().justify_center().font_family(ICON_FONT).text_size(size).text_color(color).child(g);
  }

  status(st, t) {
    if (st === "working") return div().flex_none().w(IND).flex().justify_center()
      .child(svg("mods/workspace-chrome/spinner.svg").size(11).text_color(t.working).spin(900));
    return G[st] ? this.glyph(G[st], t[st] ?? t.dim, FONT - 2) : div().flex_none().w(IND);
  }

  picture(p, t) {
    const box = div().flex_none().w(IND).flex().justify_center();
    if (!p?.icon) return box;
    return box.child(p.tint ? svg(p.icon).size(13).text_color(p.color ?? t.foreground) : image(p.icon).w(13).h(13));
  }

  row(r, t, focus, now) {
    const sel = r.key === this.cursor, hot = sel && focus;
    const el = h_flex().h(r.kind === "head" ? HEAD : ROW).w_full().px(PAD).items_center()
      .when(sel, (el) => el.bg(focus ? t.selected : t.raised));
    const name = (text, color, bold) => div().flex_1().min_w(0).pl(4).truncate().text_color(hot ? t.accent_foreground : color).when(bold, (el) => el.font_bold()).child(text);
    const dim = (text) => div().flex_none().pl(6).text_size(FONT - 2).text_color(t.dim).child(text);
    switch (r.kind) {
      case "machine": {
        const off = r.state === "unavailable";
        return el.child(this.glyph(r.open ? G.open : G.closed, t.dim, FONT - 2))
          .child(this.glyph(r.m ? G.remote : G.local, off ? t.dim : t.muted))
          .child(name(r.m ?? this.host ?? "this computer", off ? t.dim : t.muted, true))
          .child(dim(off ? "offline" : r.state === "loading" ? "…" : String(r.count)));
      }
      case "space": {
        const s = r.s;
        return el.child(div().flex_none().w(IND))
          .child(s.tabs.length ? this.glyph(r.open ? G.open : G.closed, t.dim, FONT - 2) : div().flex_none().w(IND))
          .child(name(s.name || "~", s.active ? t.foreground : t.muted, s.active))
          .when(Boolean(s.branch), (el) => el.child(h_flex().flex_none().max_w(96).pl(6).gap(3).text_size(FONT - 2).text_color(t.dim)
            .child(div().flex_none().font_family(ICON_FONT).child(G.branch)).child(div().min_w(0).truncate().child(s.branch))))
          .when(!r.open && r.ports.length > 0, (el) => el.child(div().flex_none().pl(6).text_size(FONT - 2).text_color(t.ansi6).child(r.ports.map((f) => `:${f.local}`).join(" "))))
          .when(!r.open && s.tabs.length > 1, (el) => el.child(dim(String(s.tabs.length))))
          .child(this.status(s.status, t));
      }
      case "tab": {
        const on = r.tab.active && r.s.active;
        return el.child(div().flex_none().w(IND)).children(this.guides(r.lasts, t))
          .child(this.picture(r.lead?.program, t))
          .child(div().flex_none().pl(4).text_color(t.dim).child(String(r.tab.index)))
          .child(name(tabLabel(r.tab, r.lead), on ? t.foreground : t.muted, on))
          .child(this.status(r.tab.status, t));
      }
      case "port":
        return el.child(div().flex_none().w(IND)).children(this.guides(r.lasts, t))
          .child(this.glyph(G.web, t.ansi6, FONT - 1))
          .child(name(`localhost:${r.f.local}`, t.ansi6, false))
          .child(dim(r.f.machine ? `${r.f.machine}:${r.f.port}` : r.f.name));
      case "head":
        return el.pt(8).child(this.glyph(r.open ? G.open : G.closed, t.dim, FONT - 2))
          .child(name(r.label, t.dim, true))
          .when(r.blocked > 0, (el) => el.child(div().flex_none().pl(6).text_size(FONT - 2).text_color(t.blocked).child(`${r.blocked} need you`)))
          .child(dim(String(r.count)));
      case "agent": {
        const a = r.a, tab = r.where?.tab, since = tab ? tab.working_since ?? tab.changed_at : null;
        const detail = tab?.named ? tab.name : a.program?.name;
        return el.child(this.status(a.status, t)).child(this.picture(a.program, t))
          .child(h_flex().flex_1().min_w(0).pl(4).gap(5)
            .child(div().flex_none().max_w(120).truncate().text_color(hot ? t.accent_foreground : a.status === "idle" && !a.focused ? t.muted : t.foreground)
              .when(a.focused, (el) => el.font_bold()).child(a.space_name || a.title || a.address))
            .when(Boolean(detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(FONT - 2).text_color(t.dim).child(detail))))
          .when(a.pinned, (el) => el.child(this.glyph(G.pin, t.dim, FONT - 3)))
          .when(Boolean(r.m), (el) => el.child(dim(r.m)))
          .when(Boolean(since) && a.status !== "idle", (el) => el.child(dim(duration(now - since))));
      }
      case "sub":
        return el.children(this.guides(r.lasts, t)).child(this.picture(r.t.program, t))
          .child(name(r.t.name || r.t.template || r.t.program?.name || r.t.address, t.muted, false))
          .child(this.status(r.status, t));
      case "loose":
        return el.child(r.t.program?.icon ? this.picture(r.t.program, t) : this.glyph(G.term, t.dim))
          .child(name(r.t.name || r.t.program?.name || (r.t.argv ?? []).join(" ") || r.t.address, t.muted, false))
          .child(dim(r.t.address))
          .child(this.status(r.status, t));
    }
    return el;
  }

  render(_cx) {
    const t = theme(), focus = this.handle.is_focused(), rows = this.rows(), now = Date.now();
    setAgentOrder(this.order);
    if (!focus && !this.prompt) this.cursor = this.current(rows) ?? this.cursor;
    let at = rows.findIndex((r) => r.key === this.cursor);
    if (at < 0 && rows.length) { at = Math.min(this.at, rows.length - 1); this.cursor = rows[at].key; }
    this.at = Math.max(at, 0);

    const header = h_flex().h(ROW + 4).flex_none().px(PAD).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_family(ICON_FONT).text_color(t.accent_foreground).child(G.term))
      .child(div().flex_1().min_w(0).truncate().font_bold().child("Sessions"))
      .child(div().flex_none().text_color(t.dim).child(focus ? "? help" : ""));

    const body = this.help
      ? v_flex().id("sessions-help").flex_1().min_h(0).p(PAD).gap(2).overflow_y_scrollbar()
        .child(div().pb(4).font_bold().child("sessions keys"))
        .children(HELP.map(([k, what]) => h_flex().gap(8).child(div().flex_none().w(64).text_color(t.accent_foreground).child(k)).child(div().text_color(t.muted).child(what))))
      : v_flex().relative().flex_1().min_h(0)
        .child(v_virtual_list("sessions-rows", rows.length, rows.map((r) => (r.kind === "head" ? HEAD : ROW)), (i) => rows[i].key,
          (range) => rows.slice(range.start, range.end).map((r) => this.row(r, t, focus, now)))
          .track_scroll(this.scroll).on_item_click((key, cx) => this.click(key, cx)).size_full())
        .child(Scrollbar.vertical("sessions-rows").absolute().inset_0());

    const p = this.prompt;
    const footer = !p ? null : v_flex().flex_none().px(PAD).border_t(1).border_color(t.border).bg(t.chrome)
      .child(div().h(ROW).flex().items_center().min_w(0).truncate().text_color(t.muted).child(p.label))
      .when(p.kind === "input", (el) => el.child(h_flex().h(ROW).items_center().min_w(0)
        .child(div().min_w(0).truncate().child(p.text)).child(div().flex_none().w(2).h(ROW - 6).bg(t.foreground))))
      .when(p.kind === "pick", (el) => el.children(p.items.length ? p.items.map((it, i) => h_flex().h(ROW).items_center().gap(6)
        .when(i === p.sel, (el) => el.bg(t.selected))
        .child(div().flex_none().w(14).text_color(t.dim).child(i < 9 ? String(i + 1) : ""))
        .child(this.picture(it.program, t))
        .child(div().flex_1().min_w(0).truncate().text_color(i === p.sel ? t.accent_foreground : t.foreground).child(it.label)))
        : [div().h(ROW).text_color(t.dim).child(p.loading ? "Looking for agents…" : "No agents installed there")]));

    return v_flex().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => {
        this.width = size.width; this.height = size.height;
        if (size.width > 40) this.restore = size.width;
        cx.notify();
      })
      .size_full().overflow_hidden().bg(t.background).text_color(t.foreground).text_size(FONT)
      .child(header).child(body).when(Boolean(footer), (el) => el.child(footer));
  }

  click(key, cx) {
    this.handle.focus();
    const r = this.rows().find((x) => x.key === key);
    if (!r) return;
    this.cursor = key;
    if (r.kind === "machine" || r.kind === "head") this.setOpen(key, !r.open);
    else this.go(r, false);
    cx.notify();
  }

  key(e, cx) {
    const m = e.modifiers ?? {};
    if (m.alt || m.platform) return;
    const k = m.control ? `ctrl-${e.key}` : NAMED.has(e.key) ? e.key : e.key_char ?? e.key;
    const done = this.help ? !(this.help = false) : this.prompt ? this.promptKey(k, cx) : this.act(k, cx);
    if (done) { cx.stop_propagation(); cx.notify(); }
  }

  promptKey(k, cx) {
    const p = this.prompt;
    if (p.kind === "pick") {
      const n = /^[1-9]$/.test(k) ? Number(k) - 1 : null;
      if (k === "escape") this.prompt = null;
      else if (k === "enter" || (n !== null && n < p.items.length)) {
        const it = p.items[n ?? p.sel];
        this.prompt = null;
        it?.choose();
      } else if (["j", "down", "ctrl-n"].includes(k)) p.sel = Math.min(p.items.length - 1, p.sel + 1);
      else if (["k", "up", "ctrl-p"].includes(k)) p.sel = Math.max(0, p.sel - 1);
      return true;
    }
    if (p.kind === "confirm" || k === "escape" || k === "enter") {
      this.prompt = null;
      if (p.kind === "confirm" ? k === "y" || k === "Y" : k === "enter") p.submit(p.text, cx);
      return true;
    }
    if (k === "backspace") p.text = [...p.text].slice(0, -1).join("");
    else if (k === "ctrl-u") p.text = "";
    else if (k === "ctrl-w") p.text = p.text.replace(/\S*\s*$/, "");
    else if (k === "space") p.text += " ";
    else if ([...k].length === 1) p.text += k;
    return true;
  }

  ask(kind, label, text, submit) {
    this.prompt = { kind, label, text, submit };
    return true;
  }

  // The space a row belongs to, and its machine ("" is this computer).
  spaceOf(r) {
    if (r.s) return r.s;
    if (r.kind === "agent") return r.where?.s ?? null;
    return null;
  }

  machineOf(r) {
    const m = r.kind === "machine" ? r.m : this.spaceOf(r)?.machine ?? r.m ?? null;
    return m ?? "";
  }

  // Shows what a row names; focus goes there unless stay.
  go(r, stay) {
    switch (r.kind) {
      case "space": {
        const tab = r.s.tabs.find((x) => x.active), mine = panes().filter((p) => p.tab === tab?.id && p.terminal);
        const p = mine.find((x) => x.focused) ?? mine[0];
        run("space.select", { id: r.s.id });
        if (!stay && p) run("pane.focus", { pane: p.pane });
        break;
      }
      case "tab":
        run("space.select", { id: r.s.id });
        run("tab.select", { id: r.tab.id });
        if (!stay && r.lead) run("pane.focus", { pane: r.lead.pane });
        break;
      case "agent":
        run("pane.focus", { pane: r.a.pane });
        break;
      case "sub": case "loose":
        run("terminal.peek", { terminal: r.t.address });
        return true;
      case "port":
        this.openPort(r.f);
        return true;
      default:
        return true;
    }
    if (stay) this.handle.focus();
    return true;
  }

  pickAgent(r) {
    const machine = this.machineOf(r), space = this.spaceOf(r);
    const start = (agent) => (space
      ? run("tab.new", { name: agent.name, space: space.id, argv: agent.run })
      : run("space.new", { machine, argv: agent.run }));
    const toItems = (list) => list.filter((a) => a.installed).map((a) => ({ label: a.name, program: a, choose: () => start(a) }));
    const where = space ? `${space.name}` : machine || this.host || "this computer";
    this.prompt = { kind: "pick", label: `New agent in ${where}`, items: toItems(shared(KNOWN)?.[machine] ?? []), sel: 0, loading: true };
    const p = this.prompt;
    this.spawnLater = async (cx) => {
      const list = await knownAgents({ on: machine || null }).catch(() => null);
      if (list) setShared(KNOWN, { ...shared(KNOWN), [machine]: list });
      if (this.prompt !== p) return;
      p.loading = false;
      if (list) { p.items = toItems(list); p.sel = Math.min(p.sel, Math.max(0, p.items.length - 1)); }
      cx.notify();
    };
    return true;
  }

  act(k, cx) {
    const rows = this.rows(), i = Math.max(0, rows.findIndex((x) => x.key === this.cursor)), r = rows[i];
    const seq = (this.pending ?? "") + k, half = Math.max(1, Math.floor(this.height / ROW / 2));
    this.pending = null;
    const fold = r && ["machine", "space", "head"].includes(r.kind) && (r.kind !== "space" || r.s.tabs.length > 0);
    const term = r && (r.kind === "agent" ? r.a.address : r.t?.address);
    const done = (() => {
      switch (seq) {
        case "j": case "down": case "ctrl-n": return this.move(1, rows);
        case "k": case "up": case "ctrl-p": return this.move(-1, rows);
        case "ctrl-d": case "pagedown": return this.move(half, rows);
        case "ctrl-u": case "pageup": return this.move(-half, rows);
        case "gg": case "home": return this.move(-rows.length, rows);
        case "G": case "end": return this.move(rows.length, rows);
        case "g": this.pending = k; return true;
        case "enter": case "o": return !r || (fold && r.kind !== "space" ? this.setOpen(r.key, !r.open) : this.go(r, false));
        case "space": return !r || (fold ? this.setOpen(r.key, !r.open) : this.go(r, true));
        case "l": case "right":
          if (!r) return true;
          if (fold) return !r.open ? this.setOpen(r.key, true) : rows[i + 1] && !["machine", "head"].includes(rows[i + 1].kind) ? this.move(1, rows) : true;
          return this.go(r, false);
        case "h": case "left": {
          if (fold && r.open) return this.setOpen(r.key, false);
          const up = r?.kind === "tab" ? `s:${r.s.id}` : r?.kind === "space" ? `m:${r.m ?? ""}` : null;
          return !up || this.select(up, rows);
        }
        case "a": return !r || run("space.new", { machine: this.machineOf(r) }) || true;
        case "t": {
          const s = r && this.spaceOf(r);
          return !r || (s ? run("tab.new", { space: s.id }) : run("space.new", { machine: this.machineOf(r) })) || true;
        }
        case "n": return !r || this.pickAgent(r);
        case "r":
          if (r?.kind === "space") return this.ask("input", `Rename space (empty: automatic)`, r.s.named ? r.s.name : "", (text) => run("space.rename", { id: r.s.id, name: text.trim() }));
          if (r?.kind === "tab") return this.ask("input", `Rename tab ${r.tab.index} (empty: its number)`, r.tab.named ? r.tab.name : "", (text) => run("tab.rename", { id: r.tab.id, name: text.trim() }));
          return true;
        case "d":
          if (r?.kind === "space") return this.ask("confirm", `Close space ${r.s.name} and its ${r.s.tabs.length} tab(s)? y/n`, "", () => run("space.close", { id: r.s.id, confirmed: true }));
          if (r?.kind === "tab") return this.ask("confirm", `Close tab ${r.tab.index} of ${r.s.name}? y/n`, "", () => run("tab.close", { id: r.tab.id, confirmed: true }));
          if (term) return this.ask("confirm", `Kill ${term}? y/n`, "", () => run("terminal.kill", { terminal: term }));
          return true;
        case "J": case "K": {
          const step = k === "J" ? 1 : -1;
          if (r?.kind === "space") run("space.move", { id: r.s.id, index: Math.max(1, r.s.index + step) });
          else if (r?.kind === "tab") run("tab.move", { id: r.tab.id, index: Math.max(1, r.tab.index + step) });
          return true;
        }
        case "O": return r?.kind !== "port" || this.system(this.url(r.f));
        case "y": return r?.kind !== "port" || this.copy(this.url(r.f));
        case "p": return !term || run("terminal.peek", { terminal: term }) || true;
        case "P": return r?.kind !== "agent" || run("terminal.pin", { terminal: r.a.address, pinned: !r.a.pinned }) || true;
        case "T": return !(r?.kind === "sub" || r?.kind === "loose") || run("terminal.keep", { terminal: r.t.address, place: "tab" }) || true;
        case "?": this.help = true; return true;
        case "q": return this.hide();
        case "escape": return this.leave();
        default: return false;
      }
    })();
    if (this.spawnLater) { const f = this.spawnLater; this.spawnLater = null; cx.spawn(f); }
    return done;
  }

  url(f) {
    return `http://localhost:${f.local}/`;
  }

  // In the browser, beside the terminal the server runs in.
  openPort(f) {
    run("pane.split", { direction: "right", pane: f.pane, mod: "browser", props: { url: this.url(f) } });
    return true;
  }

  system(url) {
    exec("sh", ["-c", OPEN, "sessions", url]).catch(() => null);
    return true;
  }

  copy(text) {
    exec("sh", ["-c", COPY, "sessions", text]).then(() => notify({ title: "Copied", body: text, level: "success" })).catch(() => null);
    return true;
  }

  // Which terminal each listening port belongs to, on every machine with one; another
  // machine's ports get a tunnel here. A port that turns up after the first look gets a toast.
  scanPorts(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        const byMachine = new Map();
        for (const p of panes()) {
          if (!p.terminal) continue;
          const m = p.terminal.includes("/") ? p.terminal.split("/")[0] : null;
          if (!byMachine.has(m)) byMachine.set(m, []);
          byMachine.get(m).push(p);
        }
        const found = [];
        for (const [m, list] of byMachine) {
          let scan;
          try { scan = await listening(m); } catch { continue; }
          const owner = new Map();
          for (const p of list) {
            const pid = await rootPid(p.terminal).catch(() => null);
            if (pid) owner.set(pid, p);
          }
          for (const l of scan.listen) {
            if (l.port >= EPHEMERAL || NOT_PAGES.has(l.port) || found.some((f) => f.machine === m && f.port === l.port)) continue;
            let pid = l.pid, p = null;
            for (let i = 0; i < 64 && pid > 1 && !p; i++) { p = owner.get(pid) ?? null; pid = scan.parent.get(pid); }
            if (p) found.push({ key: `${m ?? ""}|${l.port}`, machine: m, port: l.port, local: l.port, name: l.name && l.name !== "MainThread" ? l.name : p.program?.name || l.name, pane: p.pane, tab: p.tab });
          }
        }
        const tun = tunnels(terminals());
        for (const f of found) {
          if (!f.machine) continue;
          const have = tun.get(f.key) ?? await forward(f.machine, f.port).catch(() => null);
          if (have) f.local = have.local;
        }
        for (const [key, t] of tun) if (!found.some((f) => f.key === key)) await hc(["kill", t.address]).catch(() => null);
        if (this.portSeen) for (const f of found) if (!this.portSeen.has(f.key)) this.announce(f);
        this.portSeen = new Set(found.map((f) => f.key));
        this.ports = found;
        // For other mods, and for checking from outside: shared.json keeps it.
        const list = found.map(({ machine, port, local, tab }) => ({ machine, port, local, tab }));
        if (JSON.stringify(list) !== JSON.stringify(shared("ports") ?? null)) setShared("ports", list);
      } catch (e) {
        setShared("ports.error", String(e?.stack ?? e));
      } finally {
        this.scanning = false;
        cx.notify();
      }
    });
  }

  announce(f) {
    const s = spaces().find((x) => x.tabs.some((tab) => tab.id === f.tab)), tab = s?.tabs.find((x) => x.id === f.tab);
    notify({
      title: `localhost:${f.local} is up`,
      body: `${s?.name ?? ""} · tab ${tab?.index ?? ""} · ${f.name}${f.machine ? `, from ${f.machine}:${f.port}` : ""}. Click to open it.`,
      level: "info",
      action: { name: "tab.new", args: { mod: "browser", name: `:${f.local}`, props: { url: this.url(f) } } },
    });
  }

  move(n, rows) {
    if (!rows.length) return true;
    const i = Math.max(0, rows.findIndex((x) => x.key === this.cursor)), j = Math.min(rows.length - 1, Math.max(0, i + n));
    this.cursor = rows[j].key; this.at = j;
    this.scroll.scroll_to_item(j);
    return true;
  }

  select(key, rows) {
    const j = rows.findIndex((x) => x.key === key);
    if (j >= 0) { this.cursor = key; this.at = j; this.scroll.scroll_to_item(j); }
    return true;
  }

  expand() {
    run("layout.resize", { id: props()?.block ?? "sessions", px: Math.round(this.restore) });
  }

  // Not close(): Herdr calls a view's close() as cleanup when its block goes.
  hide() {
    this.leave();
    if (this.width > 40) { this.restore = this.width; store("width", String(Math.round(this.width))); }
    run("layout.resize", { id: props()?.block ?? "sessions", px: 0 });
    return true;
  }

  leave() {
    const s = spaces().find((x) => x.active), tab = s?.tabs.find((x) => x.active);
    const p = panes().find((x) => x.tab === tab?.id && x.terminal && x.focused) ?? panes().find((x) => x.tab === tab?.id && x.terminal);
    if (p) run("pane.focus", { pane: p.pane });
    return true;
  }
}
