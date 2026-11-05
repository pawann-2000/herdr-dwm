// A reader-view browser drawn by Herdr: pages come down with curl and show as
// rendered HTML (no JavaScript or CSS), markdown, text or images, the same
// views the preview mod uses. Links open in place, with back and forward.
// props {url} opens a page; without one it asks for an address or a search.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
import { exec, theme, settings, props, appHome, home, panes, run, notify, nextCommand, setShared } from "herdr";
import { URL } from "url";

const CACHE = "mods/browser/.cache";
const SEARCH = "https://lite.duckduckgo.com/lite/?q=";
const MAX_HTML = 600000, RECENT = 30, FONT = 13;
// $1 the address, $2 where the body goes; prints its content type, final address and status.
const GET = 'curl -sSL --compressed --max-time 25 --max-filesize 25000000 -A "Mozilla/5.0 (compatible; HerdrReader/1.0)" -o "$2" -w \'%{content_type}\\n%{url_effective}\\n%{http_code}\' "$1"';
const OPEN = 'case "$(uname)" in Darwin) open "$1";; *) xdg-open "$1" >/dev/null 2>&1 & ;; esac';
const COPY = 'printf %s "$1" | { pbcopy 2>/dev/null || wl-copy 2>/dev/null || xclip -selection clipboard; }';
const IMAGE = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };
const NAMED = new Set(["enter", "escape", "backspace", "tab", "space", "up", "down", "left", "right"]);
const LANG = { "application/json": "json", "text/javascript": "js", "application/javascript": "js", "text/css": "css", "text/x-python": "python", "application/x-yaml": "yaml", "text/yaml": "yaml" };

const HELP = [
  ["o", "open an address or search"], ["e", "edit this address"], ["H L", "back / forward"],
  ["bksp", "back"], ["r", "reload"], ["y", "copy the address"], ["O", "open in the system browser"],
  ["q", "close the browser pane"], ["enter", "go (in the address bar)"], ["esc", "leave the address bar"],
];

function hash(s) {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { a = (a * 33 + s.charCodeAt(i)) >>> 0; b = (b * 31 ^ s.charCodeAt(i)) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const decode = (v) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const attr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// An address from what was typed: a URL, a path here, a host, or else a search.
function normalize(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^(https?|file):\/\//i.test(s)) return s;
  if (s.startsWith("/") || s.startsWith("~/")) return `file://${encodeURI(s.replace(/^~/, home()))}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(s)) return `http://${s}`;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s)) return `https://${s}`;
  return SEARCH + encodeURIComponent(s);
}

const CHROME = /(^|[\s_-])(nav|navbar|navbox|navigation|menu|sidebar|toc|footer|breadcrumbs?|cookie|share|social|noprint|dropdown|portlet|skip|jump|related|advert|promo|subscribe|banner)([\s_-]|$)/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Never chrome, whatever their classes say (Wikipedia's body is "vector-toc-available").
const KEEP = new Set(["html", "body", "main", "article"]);

// Drops elements whose class, id or role names page chrome, with everything inside them.
function dropChrome(html) {
  const tag = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let out = "", last = 0, m;
  while ((m = tag.exec(html))) {
    const [, close, name, attrs] = m;
    if (close || VOID.has(name.toLowerCase()) || KEEP.has(name.toLowerCase()) || attrs.endsWith("/")) continue;
    const marks = [...attrs.matchAll(/\b(?:class|id|role)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((a) => a[1] ?? a[2] ?? a[3]).join(" ");
    if (!CHROME.test(marks)) continue;
    const same = new RegExp(`<(\\/?)${name}\\b[^>]*>`, "gi");
    same.lastIndex = tag.lastIndex;
    let depth = 1, n;
    while (depth && (n = same.exec(html))) depth += n[1] ? -1 : 1;
    const end = depth ? html.length : same.lastIndex;
    out += html.slice(last, m.index);
    last = tag.lastIndex = end;
  }
  return out + html.slice(last);
}

// Reader view: the page's main content without scripts, styles or chrome, its
// links and images made absolute so a click reports where it goes.
function reader(html, base) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "svg", "template", "iframe", "head", "object", "canvas", "select", "button", "dialog"]) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  s = dropChrome(s.replace(/<(link|meta|input|source|track|wbr)\b[^>]*>/gi, ""));
  const pick = (tag) => {
    const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>`, "i"));
    return m && m[1].replace(/<[^>]+>/g, "").trim().length > 400 ? m[1] : null;
  };
  let body = pick("main") ?? pick("article");
  if (!body) {
    body = s.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? s;
    for (const tag of ["nav", "footer", "aside", "header"]) body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  body = body
    .replace(/\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, name, a, b, c) => {
      try { return ` ${name.toLowerCase()}="${attr(new URL(decode(a ?? b ?? c ?? ""), base).href)}"`; } catch { return ""; }
    })
    .replace(/\s(class|style|id|srcset|sizes|loading|decoding|data-[\w-]+|aria-[\w-]+|role|on\w+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (body.length > MAX_HTML) body = `${body.slice(0, MAX_HTML)}<p><em>… the rest of this page is cut off</em></p>`;
  return { title, html: body };
}

export default class Browser extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.page = null; this.loading = null; this.error = null; this.code = null; this.seq = 0;
    this.past = []; this.ahead = [];
    this.editing = false;
    // A real text field: typing, paste, selection and the cursor come with it.
    this.input = InputState.new({ placeholder: "Search or type an address" });
    this.input.on("submit", (_e, cx) => { this.go(this.input.value(), cx); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.editing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.editing = false; cx.notify(); });
    try { this.recent = JSON.parse(store("recent") ?? "[]"); } catch { this.recent = []; }
    setShared("cheatsheet.browser", { title: "Browser", hint: "⌘K B, then these", keys: HELP });
    cx.spawn(async () => {
      await exec("sh", ["-c", 'mkdir -p "$1" && find "$1" -type f -mtime +1 -delete', "browser", `${appHome()}/${CACHE}`]).catch(() => null);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") { if (this.page) this.handle.focus(); else this.input.focus(); }
        cx.notify();
      }
    });
    if (props()?.url) this.load(normalize(props().url), cx);
    else {
      // Herdr settles the keyboard after it opens the tab, so ask again once it has.
      this.editing = true;
      this.input.focus();
      cx.timer.after(600, () => { if (!this.page && !this.loading) this.input.focus(); });
    }
  }

  async close() {
    this.code?.release();
    this.input?.release();
  }

  go(text, cx) {
    const url = normalize(text);
    if (!url) return;
    if (this.page) { this.past.push(this.page.url); this.ahead = []; }
    this.load(url, cx);
  }

  load(url, cx) {
    const seq = ++this.seq;
    this.loading = url; this.error = null;
    this.input.set_value(url);
    this.editing = false;
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        const page = url.startsWith("file://") ? await this.file(url) : await this.http(url);
        if (seq !== this.seq) return;
        this.code?.release();
        this.code = page.code ?? null;
        this.page = { ...page, seq };
        this.remember(page);
        this.retitle(page.title);
        if (!this.editing) this.input.set_value(page.url);
      } catch (e) {
        if (seq === this.seq) this.error = String(e?.message ?? e);
      } finally {
        if (seq === this.seq) this.loading = null;
        cx.notify();
      }
    });
  }

  async http(url) {
    const rel = `${CACHE}/${hash(url)}-${this.seq}`, abs = `${appHome()}/${rel}`;
    await exec("mkdir", ["-p", `${appHome()}/${CACHE}`]);
    const r = await exec("sh", ["-c", GET, "browser", url, abs]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not load ${url}`);
    const [type = "", final = url, status = "0"] = r.stdout.split("\n");
    return this.view(abs, rel, type.split(";")[0].trim().toLowerCase(), final || url, Number(status));
  }

  async file(url) {
    const path = decodeURIComponent(new URL(url).pathname), ext = path.split(".").pop().toLowerCase();
    const rel = `${CACHE}/${hash(url)}-${this.seq}`, abs = `${appHome()}/${rel}`;
    const r = await exec("sh", ["-c", 'mkdir -p "${2%/*}" && cp "$1" "$2"', "browser", path, abs]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Cannot read ${path}`);
    const type = { html: "text/html", htm: "text/html", md: "text/markdown", markdown: "text/markdown", json: "application/json" }[ext]
      ?? Object.keys(IMAGE).find((k) => IMAGE[k] === (ext === "jpeg" ? "jpg" : ext)) ?? "text/plain";
    return this.view(abs, rel, type, url, 200);
  }

  // What the downloaded body at abs becomes, by its content type.
  async view(abs, rel, type, url, status) {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || new URL(url).host || url);
    if (IMAGE[type]) {
      await exec("mv", [abs, `${abs}.${IMAGE[type]}`]);
      return { url, status, title: name, kind: "image", path: `${rel}.${IMAGE[type]}` };
    }
    const textual = !type || type.startsWith("text/") || /json|xml|javascript|yaml|toml/.test(type);
    if (!textual) return { url, status, title: name, kind: "info", text: `${type}: press O to open it in the system browser` };
    const r = await exec("cat", [abs]);
    if (r.code !== 0) throw new Error("This page is too big to show here: press O to open it in the system browser");
    const body = r.stdout;
    if (/html|xhtml/.test(type) || (!type && /<html|<body/i.test(body))) {
      const { title, html } = reader(body, url);
      // An app that draws itself with JavaScript (a Vite or Next dev server) leaves nothing to read.
      if (html.replace(/<[^>]+>/g, "").trim().length < 40 && /<script/i.test(body)) {
        return { url, status, title: title || name, kind: "info", text: "This page draws itself with JavaScript, which the reader view doesn't run. Press O to open it in your system browser." };
      }
      return { url, status, title: title || name, kind: "html", html };
    }
    if (/markdown/.test(type) || /\.(md|markdown)$/i.test(new URL(url).pathname)) return { url, status, title: name, kind: "markdown", text: body };
    const t = theme();
    const code = EditorState.new({ language: LANG[type] ?? "txt", readonly: true, value: body.length > 400000 ? `${body.slice(0, 400000)}\n… (cut off)` : body,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    return { url, status, title: name, kind: "code", code };
  }

  remember(page) {
    this.recent = [{ url: page.url, title: page.title }, ...this.recent.filter((x) => x.url !== page.url)].slice(0, RECENT);
    store("recent", JSON.stringify(this.recent));
  }

  // A tab that is just this browser is named after its page, as the dwm bar's tags show.
  retitle(title) {
    const me = panes().find((p) => p.mod === "browser" && p.focused);
    if (!me || panes().filter((p) => p.tab === me.tab).length > 1 || !title) return;
    run("tab.rename", { id: me.tab, name: title.length > 24 ? `${title.slice(0, 23)}…` : title });
  }

  link(url, cx) {
    let target;
    try { target = new URL(url, this.page?.url).href; } catch { return; }
    const here = this.page?.url.split("#")[0];
    if (target.split("#")[0] === here && target.includes("#")) return;
    if (/^(https?|file):/i.test(target)) this.go(target, cx);
    else this.system(target);
  }

  back(cx) {
    if (!this.past.length) return;
    if (this.page) this.ahead.push(this.page.url);
    this.load(this.past.pop(), cx);
  }

  forward(cx) {
    if (!this.ahead.length) return;
    if (this.page) this.past.push(this.page.url);
    this.load(this.ahead.pop(), cx);
  }

  system(url) {
    exec("sh", ["-c", OPEN, "browser", url]).catch((e) => notify({ title: "Browser", body: String(e), level: "error" }));
  }

  edit(text) {
    this.input.set_value(text);
    if (text) this.input.set_selected_range({ start: 0, end: text.length });
    this.editing = true;
    this.input.focus();
  }

  key(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform && e.key === "l" && !m.shift && !m.alt && !m.control) { this.edit(this.page?.url ?? ""); cx.stop_propagation(); cx.notify(); return; }
    if (m.alt || m.platform) return;
    const k = m.control ? `ctrl-${e.key}` : NAMED.has(e.key) ? e.key : e.key_char ?? e.key;
    // A key that reaches here while the page itself doesn't have the keyboard was
    // typed in the address field: it does the typing, and Esc puts the page back.
    if (!this.handle.is_focused()) {
      if (k !== "escape" || !this.page) return;
      this.input.set_value(this.loading ?? this.page.url);
      this.editing = false;
      this.handle.focus();
    } else {
      const url = this.page?.url;
      if (k === "o" || k === "ctrl-l") this.edit("");
      else if (k === "e") this.edit(url ?? "");
      else if (k === "H" || k === "backspace") this.back(cx);
      else if (k === "L") this.forward(cx);
      else if (k === "r" && url) this.load(url, cx);
      else if (k === "O" && url) this.system(url);
      else if (k === "y" && url) exec("sh", ["-c", COPY, "browser", url]).then(() => notify({ title: "Copied", body: url, level: "success" })).catch(() => null);
      else if (k === "q") { const me = panes().find((p) => p.mod === "browser" && p.focused); if (me) run("pane.close", { pane: me.pane }); }
      else return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  render(_cx) {
    const t = theme(), p = this.page;
    const button = (id, label, on, act) => div().id(id).flex_none().w(20).flex().justify_center()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.accent_foreground)))
      .on_click((_e, cx) => { if (on) { act(cx); cx.notify(); } }).child(label);

    const field = Input.new(this.input).flex_1().min_w(0).h(22).px(8).bg(t.background)
      .border_1().border_color(this.editing ? t.accent : t.border)
      .text_size(FONT).text_color(this.editing ? t.foreground : t.muted);

    const bar = h_flex().h(30).flex_none().px(6).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(button("browser-back", "‹", this.past.length > 0, (cx) => this.back(cx)))
      .child(button("browser-forward", "›", this.ahead.length > 0, (cx) => this.forward(cx)))
      .child(button("browser-reload", "↻", Boolean(p), (cx) => this.load(p.url, cx)))
      .child(field)
      .child(div().flex_none().w(44).text_right().text_size(FONT - 2).text_color(this.loading ? t.working : p?.status >= 400 ? t.blocked : t.dim)
        .child(this.loading ? "…" : p?.status ? String(p.status) : ""));

    const body = this.error
      ? div().flex_1().p(14).text_color(t.blocked).child(`${this.error}\n\nPress e to edit the address, r to try again.`)
      : !p
        ? v_flex().id("browser-start").flex_1().min_h(0).p(14).gap(4).overflow_y_scrollbar()
          .child(div().pb(8).text_color(t.dim).child("Type an address, a path here, or words to search, then enter."))
          .when(this.recent.length > 0, (el) => el.child(div().pb(2).font_bold().text_color(t.muted).child("Recent")))
          .children(this.recent.map((r, i) => h_flex().id(`recent-${i}`).gap(10).cursor_pointer().hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => { this.go(r.url, cx); cx.notify(); })
            .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(r.title || r.url))
            .child(div().flex_1().min_w(0).truncate().text_size(FONT - 2).text_color(t.dim).child(r.url))))
        : p.kind === "html" || p.kind === "markdown"
          ? div().flex_1().min_h(0).px(18).py(10)
            .child((p.kind === "html" ? TextView.html(`browser-${p.seq}`, p.html) : TextView.markdown(`browser-${p.seq}`, p.text))
              .scrollable(true).selectable(true).on_link_click((url, cx) => { this.link(url, cx); cx.notify(); }).size_full())
          : p.kind === "image"
            ? div().flex_1().min_h(0).p(10).flex().items_center().justify_center().child(image(p.path).size_full())
            : p.kind === "code"
              ? Editor.new(this.code).flex_1().min_h(0)
              : div().flex_1().p(14).text_color(t.dim).child(p.text);

    const foot = h_flex().h(20).flex_none().px(8).gap(8).items_center().border_t(1).border_color(t.border).text_size(FONT - 2).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p?.title ?? ""))
      .child(div().flex_none().child(this.editing ? "enter go · esc back" : "o open · H L back/fwd · r reload · O system · q close"));

    // Clicking the page takes the keyboard for the shortcuts; clicking the address field keeps it there.
    return v_flex().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().overflow_hidden().bg(t.background).text_color(t.foreground).text_size(FONT)
      .child(bar)
      .child(v_flex().id("browser-body").flex_1().min_h(0).on_mouse_down("left", () => { if (this.page) this.handle.focus(); }).child(body))
      .child(foot);
  }
}
