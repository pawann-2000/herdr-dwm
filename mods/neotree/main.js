// neo-tree for the dwm layout: the shown tab's folder as a tree with indent
// markers, devicons and git status, driven by neo-tree's keys (? lists them).
// Files open in the tab's vim/nvim when one runs, else in a new editor pane
// placed the way dwm's spawn places clients.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, hc, run, notify, watchFolder, theme, props, nextCommand, shared, setShared, openOverlay, closeOverlay } from "herdr";
import { ICON_FONT, GLYPH, GIT, DIR_COLOR, fileIcon } from "./icons.js";

const ROW = 20, IND = 16, PAD = 6, FONT = 13, WIDTH = 240;
// neo-tree's filtered_items defaults; H shows them, dimmed.
const HIDE_DOTFILES = true, HIDE_GITIGNORED = true;
const PER_FOLDER = 500, TOTAL = 5000, MATCHES = 300;
const VIMS = new Set(["vim", "nvim"]);
// Enter shows these in the preview mod rather than an editor.
const VIEWABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "svg", "pdf", "mp4", "mov", "mkv", "webm", "avi", "m4v",
  "mp3", "wav", "flac", "m4a", "ogg", "heic", "psd", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "pages", "numbers", "epub", "ttf", "otf", "woff", "woff2"]);
// The floating preview: {overlay, file, on} while open; the preview mod shows its file.
const PREVIEW = "neotree.preview";
const RANK = { U: 5, M: 4, D: 3, "?": 2, A: 1, S: 0 };
const NAMED = new Set(["enter", "escape", "backspace", "tab", "space", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"]);

// Lists folders under root in one call: "D\0dir\0" ("X\0dir\0" when gone), then
// "<kind>\0<name>\0" per entry, kind d or f, with l appended for links.
const LS = 'cd "$1" || exit 1; shift; for d in "$@"; do if [ -d "$d" ]; then printf "D\\0%s\\0" "$d"; else printf "X\\0%s\\0" "$d"; continue; fi; n=0; for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; b=${p##*/}; [ "$b" = .git ] && continue; k=f; [ -d "$p" ] && k=d; [ -L "$p" ] && k=${k}l; printf "%s\\0%s\\0" "$k" "$b"; n=$((n+1)); [ "$n" -ge ' + PER_FOLDER + ' ] && break; done; done; exit 0';
// Every file under the root for the filter: git's view in a repo, else find.
const FIND = 'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git -c core.quotePath=false ls-files -co --exclude-standard; else find . -maxdepth 6 \\( -name .git -o -name node_modules \\) -prune -o -type f -print | sed "s|^\\./||"; fi | head -n 50000';
const OPS = {
  add: 'case "$1" in */) mkdir -p "$1";; *) if [ -e "$1" ]; then echo "already exists" >&2; exit 1; fi; mkdir -p "$(dirname "$1")" && : > "$1";; esac',
  move: 'if [ -e "$2" ]; then echo "already exists" >&2; exit 1; fi; mkdir -p "$(dirname "$2")" && mv "$1" "$2"',
  copy: 'if [ -e "$2" ]; then echo "already exists" >&2; exit 1; fi; mkdir -p "$(dirname "$2")" && cp -R "$1" "$2"',
  trash: 'if command -v trash >/dev/null; then trash "$1"; elif command -v gio >/dev/null; then gio trash "$1"; elif command -v trash-put >/dev/null; then trash-put "$1"; else echo "no trash command (trash, gio, trash-put)" >&2; exit 1; fi',
};
const EDIT = 'cd "$2" 2>/dev/null; e="${VISUAL:-$EDITOR}"; [ -n "$e" ] || e=$(command -v nvim || command -v vim || echo vi); exec $e "$1"';
const COPY = 'printf %s "$1" | { pbcopy 2>/dev/null || wl-copy 2>/dev/null || xclip -selection clipboard; }';
// Opens $2 (on machine $1, "" for this one, copied here first) with this machine's app for it.
const OPEN = 'if [ -n "$1" ]; then d=$(mktemp -d) && f="$d/${2##*/}" && hc exec --on "$1" cat "$2" > "$f" || exit 1; else f=$2; fi; case "$(uname)" in Darwin) open "$f";; *) xdg-open "$f" >/dev/null 2>&1 & ;; esac';

const HELP = [
  ["j k", "down / up"], ["gg G", "top / bottom"], ["^d ^u", "half page"],
  ["enter o", "open / toggle"], ["l h", "expand / collapse"], ["space", "toggle folder"],
  ["C z", "close node / all"], ["s S t", "vsplit / split / tab"],
  ["a A", "add file / folder"], ["r m c", "rename / move / copy"], ["d", "trash"],
  ["y Y", "copy path / full path"], ["H", "hidden files"], ["/", "filter"],
  [".", "set root"], ["bksp -", "up a folder"], ["[g ]g", "prev / next change"],
  ["P", "preview, following the cursor"], ["p", "preview in a pane"], ["O", "open with the system app"],
  ["R", "refresh"], ["q", "close"], ["esc", "back to the terminal"],
];

const join = (a, b) => (a ? `${a}/${b}` : b);
const parent = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const ancestors = (p) => { const out = []; for (let q = parent(p); q; q = parent(q)) out.push(q); return out; };
const parentAbs = (p) => p.replace(/\/[^/]+\/?$/, "") || "/";
const extOf = (p) => { const n = p.slice(p.lastIndexOf("/") + 1); return n.includes(".") ? lower(n.slice(n.lastIndexOf(".") + 1)) : ""; };
const abbrev = (p) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
const vimEscape = (p) => p.replace(/[ \t\\%#|"*?[{`$!<']/g, "\\$&");
const lower = (s) => s.toLowerCase();
const byName = (a, b) => Number(b.dir) - Number(a.dir) || (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0);
const failed = (e) => notify({ title: "neo-tree", body: String(e?.message ?? e), level: "error" });
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };

function parseLs(out) {
  const f = out.split("\0"), dirs = new Map();
  let cur = null;
  for (let i = 0; i + 1 < f.length; i += 2) {
    if (f[i] === "D" || f[i] === "X") dirs.set(f[i + 1] === "." ? "" : f[i + 1], (cur = f[i] === "D" ? [] : null));
    else cur?.push({ name: f[i + 1], dir: f[i][0] === "d", link: f[i].length > 1 });
  }
  for (const list of dirs.values()) list?.sort(byName);
  return dirs; // null: that folder is gone
}

function code(xy) {
  if (xy === "??") return "?";
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "U";
  if (xy.includes("D")) return "D";
  if (xy[0] === "A") return "A";
  return xy[1] === " " ? "S" : "M";
}

// Paths relative to root; a folder takes the most urgent status inside it.
async function gitStatus(root, on) {
  const pre = await exec("git", ["rev-parse", "--show-prefix"], { cwd: root, on }).catch(() => null);
  if (pre?.code !== 0) return null;
  const prefix = pre.stdout.trim();
  // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would fire again.
  const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignored=matching", "."], { cwd: root, on }).catch(() => null);
  if (r?.code !== 0) return null;
  const marks = new Map(), ignored = new Set();
  for (const entry of r.stdout.split("\0").slice(0, 20000)) {
    const xy = entry.slice(0, 2), full = entry.slice(3);
    if (entry.length < 4 || !full.startsWith(prefix)) continue;
    const path = full.slice(prefix.length).replace(/\/$/, "");
    if (!path) continue;
    if (xy === "!!") { ignored.add(path); continue; }
    const c = code(xy);
    for (const p of [path, ...ancestors(path)]) if (!(RANK[marks.get(p)] >= RANK[c])) marks.set(p, c);
  }
  return { marks, ignored };
}

function fuzzy(s, q) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

// A tree holding just these files, every folder on the way open.
function tree(paths) {
  const entries = new Map([["", []]]), open = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join("/"), dir = i < parts.length - 1;
      if (dir && open.has(p)) return;
      entries.get(parts.slice(0, i).join("/")).push({ name, dir, link: false });
      if (dir) { open.add(p); entries.set(p, []); }
    });
  }
  for (const list of entries.values()) list.sort(byName);
  return { entries, open };
}

// dwm's spawn (mods/dwm/bar.js): the first split makes the master column, the rest stack below.
// what: { argv } for a program, { mod, props } for a mod pane.
function spawn(what) {
  const tab = spaces().find((s) => s.active)?.tabs.find((x) => x.active);
  if (!tab) return run(what.argv ? "space.new" : "tab.new", what);
  const ps = panes().filter((p) => p.tab === tab.id);
  const at = ps.length < 2 ? { direction: "right", pane: ps[0]?.pane } : { direction: "down", pane: ps[ps.length - 1].pane };
  run("pane.split", { ...at, ...what });
  if (tab.zoomed) run("pane.zoom");
}

export default class NeoTree extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.last = {}; this.saved = new Map(); this.override = null;
    this.ctx = null; this.entries = new Map(); this.open = new Set(); this.marks = new Map(); this.ignored = new Set();
    this.showHidden = !HIDE_DOTFILES && !HIDE_GITIGNORED;
    this.cursor = null; this.at = 0; this.width = WIDTH; this.height = 0;
    this.restore = Number(store("width")) > 40 ? Number(store("width")) : WIDTH;
    this.prompt = null; this.filter = null; this.files = null; this.help = false; this.pending = null;
    this.tick = 0; this.dirty = false; this.again = false;
    setShared("cheatsheet.neotree", { title: "File tree", hint: "alt-e, then these", keys: HELP });
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand());
        cx.notify();
      }
    });
    // Local folders are watched (that sets dirty); remote ones are polled every 5 s.
    cx.timer.every(1000, (cx) => {
      const ctx = this.ctx;
      if (ctx && (this.dirty || ((ctx.on || this.watching !== ctx) && ++this.tick % 5 === 0))) this.refresh(cx);
    });
  }

  command(c) {
    const shut = this.width < 8;
    if (c === "focus") {
      if (shut) this.expand();
      this.handle.focus();
    } else if (c === "toggle") {
      if (shut) { this.expand(); this.handle.focus(); }
      else if (this.handle.is_focused()) this.hide();
      else this.handle.focus();
    }
  }

  // The terminal the tree follows: the one last focused in the shown tab.
  target() {
    const f = focused();
    if (!f) return null;
    const ps = panes().filter((p) => p.tab === f.tab && p.terminal);
    if (f.pane && ps.some((p) => p.pane === f.pane)) this.last[f.tab] = f.pane;
    return ps.find((p) => p.pane === this.last[f.tab]) ?? ps.find((p) => p.focused) ?? ps[0] ?? null;
  }

  where() {
    const f = focused(), space = spaces().find((s) => s.id === f?.space), cwd = this.target()?.cwd || space?.folder || null;
    const o = this.override, root = o && o.space === f?.space && o.base === cwd ? o.root : cwd, on = space?.machine ?? null;
    return root ? { root, on, key: JSON.stringify([on, root]) } : null;
  }

  abs(rel) {
    const root = this.ctx.root;
    return !rel ? root : root === "/" ? `/${rel}` : `${root}/${rel}`;
  }

  switchTo(w, cx) {
    if (this.ctx) this.saved.set(this.ctx.key, { open: this.open, cursor: this.cursor });
    let saved = w && this.saved.get(w.key);
    if (w && !saved) {
      try { saved = { open: new Set(JSON.parse(store(`open:${w.key}`) ?? "[]")), cursor: null }; }
      catch { saved = null; }
    }
    this.ctx = w; this.entries = new Map(); this.open = saved?.open ?? new Set();
    this.cursor = this.nextCursor ?? saved?.cursor ?? null; this.nextCursor = null; this.at = 0;
    this.marks = new Map(); this.ignored = new Set(); this.filter = null; this.prompt = null;
    this.error = null; this.watching = null; this.loading = false;
    if (w) this.refresh(cx, true);
  }

  saveOpen() {
    if (this.ctx) store(`open:${this.ctx.key}`, JSON.stringify([...this.open].slice(0, 500)));
  }

  // urgent: run again as soon as a load in flight ends, not on the next tick.
  refresh(cx, urgent) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.loading) { if (urgent) this.again = true; else this.dirty = true; return; }
    this.loading = true; this.dirty = false;
    cx.spawn(async (cx) => {
      try {
        const dirs = ["", ...[...this.open].filter((d) => ancestors(d).every((a) => this.open.has(a)))];
        const r = await exec("sh", ["-c", LS, "neotree", ctx.root, ...dirs.map((d) => d || ".")], { on: ctx.on });
        if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot list this folder");
        const listed = parseLs(r.stdout), git = await gitStatus(ctx.root, ctx.on);
        if (this.ctx !== ctx) return;
        for (const [d, list] of listed) if (list === null) this.open.delete(d);
        const kept = [...this.entries].filter(([d]) => this.open.has(d) && !listed.has(d));
        this.entries = new Map([...kept, ...[...listed].filter(([, list]) => list)]);
        this.marks = git?.marks ?? new Map(); this.ignored = git?.ignored ?? new Set(); this.error = null;
        this.watch(cx);
      } catch (e) {
        if (this.ctx === ctx) this.error = String(e?.message ?? e);
      } finally {
        if (this.ctx === ctx) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx, false); }
        }
        cx.notify();
      }
    });
  }

  watch(cx) {
    const ctx = this.ctx;
    if (ctx.on || this.watching === ctx) return;
    this.watching = ctx;
    cx.spawn(async () => {
      try { while (this.ctx === ctx) { await watchFolder(ctx.root); this.dirty = true; } }
      catch { if (this.watching === ctx) this.watching = null; }
    });
  }

  rows() {
    const src = this.filter ?? this, out = [];
    const walk = (dir, depth, lasts, faded) => {
      const list = (src.entries.get(dir) ?? []).filter((e) => this.showHidden || this.filter ||
        !((HIDE_DOTFILES && e.name[0] === ".") || (HIDE_GITIGNORED && this.ignored.has(join(dir, e.name)))));
      list.forEach((e, i) => {
        if (out.length >= TOTAL) return;
        const path = join(dir, e.name), last = i === list.length - 1, open = e.dir && src.open.has(path);
        const dim = faded || e.name[0] === "." || this.ignored.has(path);
        out.push({ path, name: e.name, dir: e.dir, link: e.link, depth, lasts: [...lasts, last], open, dim,
          empty: open && src.entries.get(path)?.length === 0, git: this.marks.get(path) });
        if (open && depth < 40) walk(path, depth + 1, [...lasts, last], dim);
      });
    };
    walk("", 0, [], false);
    return out;
  }

  // neo-tree's indent markers: │ while a level has more below, └ on its last row.
  guides(r, t) {
    const out = [], x = IND / 2 - 1;
    for (let c = 0; c < r.depth; c++) {
      const own = c === r.depth - 1, end = own && r.lasts[r.depth];
      const cell = div().flex_none().w(IND).h(ROW).relative();
      out.push(own || !r.lasts[c + 1]
        ? cell.child(div().absolute().left(x).top(0).w(1).h(end ? ROW / 2 : ROW).bg(t.border))
          .when(end, (el) => el.child(div().absolute().left(x).top(ROW / 2).w(IND / 2).h(1).bg(t.border)))
        : cell);
    }
    return out;
  }

  row(r, t, focus) {
    const sel = r.path === this.cursor, git = r.git && GIT[r.git];
    const icon = r.dir ? { glyph: !r.open ? GLYPH.folder : r.empty ? GLYPH.folderEmpty : GLYPH.folderOpen, color: DIR_COLOR } : fileIcon(r.name);
    const fg = sel && focus ? t.accent_foreground : git ? git.color : r.dim ? t.dim : r.link ? t.ansi6 : r.dir ? DIR_COLOR : t.foreground;
    return h_flex().h(ROW).w_full().px(PAD).items_center()
      .when(sel, (el) => el.bg(focus ? t.selected : t.raised))
      .children(this.guides(r, t))
      .child(div().flex_none().w(IND).flex().justify_center().font_family(ICON_FONT).text_color(icon.color).child(icon.glyph))
      .child(div().flex_1().min_w(0).pl(4).truncate().text_color(fg).child(r.name))
      .when(Boolean(git), (el) => el.child(div().flex_none().pl(6).font_family(ICON_FONT).text_size(FONT - 3).text_color(git.color).child(git.glyph)));
  }

  render(cx) {
    const w = this.where();
    if (w?.key !== this.ctx?.key) this.switchTo(w, cx);
    const t = theme(), focus = this.handle.is_focused(), rows = this.rows(), branch = this.target()?.branch;
    let at = rows.findIndex((r) => r.path === this.cursor);
    if (at < 0 && rows.length) { at = Math.min(this.at, rows.length - 1); this.cursor = rows[at].path; }
    this.at = Math.max(at, 0);
    const pv = shared(PREVIEW), cur = rows[this.at];
    if (pv && cur && !cur.dir && this.ctx && (pv.file !== this.abs(cur.path) || pv.on !== this.ctx.on)) setShared(PREVIEW, { ...pv, file: this.abs(cur.path), on: this.ctx.on });

    const header = h_flex().h(ROW + 4).flex_none().px(PAD).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_family(ICON_FONT).text_color(DIR_COLOR).child(GLYPH.folderOpen))
      .child(div().flex_1().min_w(0).truncate().font_bold().child(this.ctx ? abbrev(this.ctx.root) : "No folder"))
      .when(Boolean(branch), (el) => el.child(h_flex().flex_none().gap(4).text_color(t.muted)
        .child(div().font_family(ICON_FONT).child(GLYPH.branch)).child(branch)));

    const body = this.help
      ? v_flex().id("neotree-help").flex_1().min_h(0).p(PAD).gap(2).overflow_y_scrollbar()
        .child(div().pb(4).font_bold().child("neo-tree keys"))
        .children(HELP.map(([k, what]) => h_flex().gap(8).child(div().flex_none().w(64).text_color(t.accent_foreground).child(k)).child(div().text_color(t.muted).child(what))))
      : rows.length
        ? v_flex().relative().flex_1().min_h(0)
          .child(v_virtual_list("neotree-rows", rows.length, ROW, (i) => rows[i].path,
            (range) => rows.slice(range.start, range.end).map((r) => this.row(r, t, focus)))
            .track_scroll(this.scroll).on_item_click((key, cx) => this.click(key, cx)).size_full())
          .child(Scrollbar.vertical("neotree-rows").absolute().inset_0())
        : div().flex_1().p(PAD).text_color(t.dim).child(this.error ?? (this.filter ? (this.filter.loading ? "Searching…" : "No matches") : this.loading ? "Loading…" : this.ctx ? "Empty folder" : ""));

    const p = this.prompt;
    const footer = p
      ? v_flex().flex_none().px(PAD).border_t(1).border_color(t.border).bg(t.chrome)
        .child(div().h(ROW).flex().items_center().min_w(0).truncate().text_color(t.muted).child(p.label))
        .when(p.kind !== "confirm", (el) => el.child(h_flex().h(ROW).items_center().min_w(0)
          .child(div().min_w(0).truncate().child(p.text)).child(div().flex_none().w(2).h(ROW - 6).bg(t.foreground))))
      : this.filter
        ? h_flex().h(ROW).flex_none().px(PAD).gap(6).items_center().border_t(1).border_color(t.border).text_color(t.muted)
          .child(div().flex_1().min_w(0).truncate().child(`/${this.filter.text}`))
          .child(div().flex_none().text_color(t.dim).child(this.filter.loading ? "…" : `${this.filter.count}`))
        : null;

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
    const r = this.rows().find((x) => x.path === key);
    if (!r) return;
    if (r.dir) { this.cursor = key; this.toggle(key, cx); }
    else if (this.cursor === key) this.openFile(key, null, cx);
    else this.cursor = key;
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
    if (p.kind === "confirm" || k === "escape" || k === "enter") {
      this.prompt = null;
      if (p.kind === "confirm" ? k === "y" || k === "Y" : k === "enter") p.submit(p.text, cx);
      else p.cancel?.();
      return true;
    }
    if (p.kind === "filter" && ["down", "up", "ctrl-n", "ctrl-p"].includes(k)) return this.move(k === "down" || k === "ctrl-n" ? 1 : -1, this.rows());
    if (k === "backspace") p.text = [...p.text].slice(0, -1).join("");
    else if (k === "ctrl-u") p.text = "";
    else if (k === "ctrl-w") p.text = p.text.replace(/\S*\s*$/, "");
    else if (k === "space") p.text += " ";
    else if ([...k].length === 1) p.text += k;
    else return true;
    p.change?.(p.text, cx);
    return true;
  }

  ask(kind, label, text, submit) {
    this.prompt = { kind, label, text, submit };
    return true;
  }

  act(k, cx) {
    const rows = this.rows(), i = Math.max(0, rows.findIndex((x) => x.path === this.cursor)), r = rows[i];
    const seq = (this.pending ?? "") + k, half = Math.max(1, Math.floor(this.height / ROW / 2));
    this.pending = null;
    switch (seq) {
      case "j": case "down": case "ctrl-n": return this.move(1, rows);
      case "k": case "up": case "ctrl-p": return this.move(-1, rows);
      case "ctrl-d": case "pagedown": return this.move(half, rows);
      case "ctrl-u": case "pageup": return this.move(-half, rows);
      case "gg": case "home": return this.move(-rows.length, rows);
      case "G": case "end": return this.move(rows.length, rows);
      case "g": case "[": case "]": this.pending = k; return true;
      case "]g": case "[g": {
        const step = seq[0] === "]" ? 1 : -1;
        for (let j = i + step; j >= 0 && j < rows.length; j += step) if (rows[j].git && !rows[j].dir) return this.move(j - i, rows);
        return true;
      }
      case "enter": case "o": return !r || (r.dir ? this.toggle(r.path, cx) : this.openFile(r.path, null, cx));
      case "l": case "right":
        if (!r) return true;
        if (!r.dir) return this.openFile(r.path, null, cx);
        return !r.open ? this.toggle(r.path, cx) : rows[i + 1]?.depth > r.depth ? this.move(1, rows) : true;
      case "h": case "left":
        if (r?.dir && r.open) return this.toggle(r.path, cx);
        return !r || !parent(r.path) || this.select(parent(r.path), rows);
      case "space": return !r?.dir || this.toggle(r.path, cx);
      case "C": {
        const d = r?.dir && r.open ? r.path : r ? parent(r.path) : "";
        return !d || (this.toggle(d, cx), this.select(d, this.rows()));
      }
      case "z": (this.filter ?? this).open.clear(); this.saveOpen(); return true;
      case "s": return !r || r.dir || this.openFile(r.path, "right", cx);
      case "S": return !r || r.dir || this.openFile(r.path, "down", cx);
      case "t": return !r || r.dir || this.openFile(r.path, "tab", cx);
      case "a": case "A": {
        if (!this.ctx) return true;
        const base = !r ? "" : r.dir ? r.path : parent(r.path), folder = k === "A";
        return this.ask("input", `${folder ? "Add folder" : "Add (end with / for a folder)"} in ${base ? `${base}/` : "./"}`, "", (text, cx) => {
          if (!text.trim()) return;
          const rel = join(base, folder && !text.endsWith("/") ? `${text}/` : text);
          this.op("add", [this.abs(rel)], rel.replace(/\/$/, ""), cx);
        });
      }
      case "r": return !r || this.ask("input", `Rename ${r.name}`, r.name, (text, cx) => {
        const to = join(parent(r.path), text);
        if (text && to !== r.path) this.op("move", [this.abs(r.path), this.abs(to)], to, cx);
      });
      case "m": case "c": return !r || this.ask("input", `${k === "m" ? "Move" : "Copy"} ${r.name} to`, r.path, (text, cx) => {
        if (text && text !== r.path) this.op(k === "m" ? "move" : "copy", [this.abs(r.path), this.abs(text)], text.replace(/\/$/, ""), cx);
      });
      case "d": return !r || this.ask("confirm", `Trash ${r.name}${r.dir ? "/" : ""}? y/n`, "", (_text, cx) => this.op("trash", [this.abs(r.path)], null, cx));
      case "y": case "Y": return !r || this.copyPath(k === "y" ? r.path : this.abs(r.path), cx);
      case "H": this.showHidden = !this.showHidden; return true;
      case ".": {
        const d = !r ? "" : r.dir ? r.path : parent(r.path);
        return !d || this.setRoot(this.abs(d), null);
      }
      case "backspace": case "-": {
        if (!this.ctx || this.ctx.root === "/") return true;
        const up = parentAbs(this.ctx.root);
        return this.setRoot(up, this.ctx.root.slice(up === "/" ? 1 : up.length + 1));
      }
      case "R": this.refresh(cx, true); return true;
      case "/": return this.startFilter(cx);
      case "P": return this.togglePreview(r);
      case "p": return !r || r.dir || this.openPreview(r.path, null);
      case "O": return !r || this.systemOpen(r.path, cx);
      case "?": this.help = true; return true;
      case "q": return this.hide();
      case "escape":
        if (shared(PREVIEW)) return this.togglePreview(r);
        if (this.filter) { this.filter = null; return true; }
        return this.leave();
      default: return false;
    }
  }

  move(n, rows) {
    if (!rows.length) return true;
    const i = Math.max(0, rows.findIndex((x) => x.path === this.cursor)), j = Math.min(rows.length - 1, Math.max(0, i + n));
    this.cursor = rows[j].path; this.at = j;
    this.scroll.scroll_to_item(j);
    return true;
  }

  select(path, rows) {
    const j = rows.findIndex((x) => x.path === path);
    if (j >= 0) { this.cursor = path; this.at = j; this.scroll.scroll_to_item(j); }
    return true;
  }

  toggle(path, cx) {
    const src = this.filter ?? this;
    if (src.open.has(path)) src.open.delete(path);
    else src.open.add(path);
    if (!this.filter) {
      this.saveOpen();
      if ([...this.open].some((d) => !this.entries.has(d) && ancestors(d).every((a) => this.open.has(a)))) this.refresh(cx, true);
    }
    return true;
  }

  setRoot(root, cursor) {
    const f = focused(), base = this.target()?.cwd || spaces().find((s) => s.id === f?.space)?.folder || null;
    this.override = { space: f?.space, base, root };
    this.nextCursor = cursor;
    return true;
  }

  openFile(path, how, cx) {
    if (VIEWABLE.has(extOf(path))) return this.openPreview(path, how);
    const file = this.abs(path), t = this.target();
    const vim = !how && [t, ...panes().filter((p) => p.tab === t?.tab && p.terminal)].find((p) => p && VIMS.has(p.program?.key));
    if (vim) {
      run("pane.focus", { pane: vim.pane });
      // hc keys can't type ':', so go through Ex mode (gQ in vim and nvim) and back with :visual.
      cx.spawn(async () => {
        try {
          for (const args of [["keys", vim.terminal, "esc", "esc", "g", "shift+q"], ["send", vim.terminal, `hide edit ${vimEscape(file)}`], ["send", vim.terminal, "visual"]]) {
            const r = await hc(args);
            if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim());
          }
        } catch (e) { failed(e); }
      });
      return true;
    }
    const argv = ["sh", "-c", EDIT, "neotree", file, this.ctx.root];
    if (how === "tab") run("tab.new", { argv, folder: this.ctx.root });
    else if (how) run("pane.split", { direction: how, pane: t?.pane, argv });
    else spawn({ argv });
    return true;
  }

  openPreview(path, how) {
    const t = this.target(), what = { mod: "preview", props: { file: this.abs(path), on: this.ctx.on } };
    if (how === "tab") run("tab.new", what);
    else if (how) run("pane.split", { direction: how, pane: t?.pane, ...what });
    else spawn(what);
    return true;
  }

  // neo-tree's toggle_preview: a floating window beside the tree, showing the file under the cursor.
  togglePreview(r) {
    const pv = shared(PREVIEW);
    if (pv) {
      setShared(PREVIEW, null);
      if (pv.overlay) closeOverlay(pv.overlay);
      return true;
    }
    const overlay = openOverlay({ mod: "preview", kind: "window", key: "neotree-preview", props: { follow: true },
      width: 0.5, height: 0.8, at: { x: Math.round(this.width) + 24, y: 40 } });
    setShared(PREVIEW, { overlay, file: r && !r.dir ? this.abs(r.path) : null, on: this.ctx?.on ?? null });
    return true;
  }

  systemOpen(path, cx) {
    const on = this.ctx.on ?? "", file = this.abs(path);
    cx.spawn(async () => {
      const r = await exec("sh", ["-c", OPEN, "neotree", on, file]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) failed(r.stderr.trim() || "Cannot open it");
    });
    return true;
  }

  op(name, args, select, cx) {
    const ctx = this.ctx;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", OPS[name], "neotree", ...args], { on: ctx.on });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `${name} failed`);
        if (this.ctx !== ctx) return;
        if (select) {
          for (const a of ancestors(select)) this.open.add(a);
          this.cursor = select;
          this.saveOpen();
        }
        this.refresh(cx, true);
      } catch (e) { failed(e); }
      cx.notify();
    });
  }

  copyPath(text, cx) {
    cx.spawn(async () => {
      const r = await exec("sh", ["-c", COPY, "neotree", text]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code === 0) notify({ title: "Copied", body: text, level: "success" });
      else failed(r.stderr.trim() || "No clipboard program (pbcopy, wl-copy, xclip)");
    });
    return true;
  }

  startFilter(cx) {
    const ctx = this.ctx;
    if (!ctx) return true;
    this.ask("filter", "Filter (enter keeps it, esc clears)", this.filter?.text ?? "", () => {});
    this.prompt.change = (q) => this.applyFilter(q);
    this.prompt.cancel = () => { this.filter = null; };
    this.files = { ctx, list: null };
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", FIND], { cwd: ctx.root, on: ctx.on }).catch(() => null);
      if (this.files?.ctx !== ctx) return;
      this.files.list = r?.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
      if (this.filter) this.applyFilter(this.filter.text);
      cx.notify();
    });
    if (this.filter) this.applyFilter(this.filter.text);
    return true;
  }

  applyFilter(text) {
    const q = lower(text).replace(/\s+/g, ""), list = this.files?.list;
    if (!q) { this.filter = null; return; }
    if (!list) { this.filter = { text, count: 0, loading: true, entries: new Map(), open: new Set() }; return; }
    const hits = [];
    for (const p of list) {
      const s = lower(p);
      if ((!this.showHidden && /(^|\/)\./.test(p)) || !fuzzy(s, q)) continue;
      hits.push([s.slice(s.lastIndexOf("/") + 1).includes(q) ? 0 : s.includes(q) ? 1 : 2, p]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    this.filter = { text, count: hits.length, ...tree(hits.slice(0, MATCHES).map((h) => h[1])) };
    this.cursor = hits[0]?.[1] ?? null; this.at = 0;
    const j = this.rows().findIndex((x) => x.path === this.cursor);
    if (j >= 0) this.scroll.scroll_to_item(j, "center");
  }

  expand() {
    run("layout.resize", { id: props()?.block ?? "tree", px: Math.round(this.restore) });
  }

  // Not close(): Herdr calls a view's close() as cleanup when its block goes.
  hide() {
    this.leave();
    if (this.width > 40) { this.restore = this.width; store("width", String(Math.round(this.width))); }
    run("layout.resize", { id: props()?.block ?? "tree", px: 0 });
    return true;
  }

  leave() {
    const p = this.target();
    if (p) run("pane.focus", { pane: p.pane });
    return true;
  }
}
