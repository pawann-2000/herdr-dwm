// Previews one file: images as themselves, markdown and HTML rendered, text and
// code in a read-only editor, and PDFs, video, documents and fonts as a Quick
// Look thumbnail (pdftoppm or ffmpeg on Linux). props {file, on} pin a file (a
// pane); {follow: true} shows shared("neotree.preview"), which the neotree mod
// moves with its cursor (a floating window). Files on another machine are
// copied here first.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { exec, readTextFile, theme, settings, props, shared, setShared, closeOverlay, appHome } from "herdr";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "svg"]);
const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const HTML = new Set(["html", "htm"]);
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const TEXT_MAX = 1 << 20, FETCH_MAX = 64 << 20, THUMB_PX = 1200, PAGE_PX = 1400, PAGES_MAX = 40;
const ZOOMS = [1, 1.5, 2, 3, 4];
// Under the app home, where image() paths resolve; hidden, so writing it reloads no mods.
const CACHE = "mods/preview/.cache";

// ls -ln's line (its size and time make the cache key) and file(1)'s description.
const INFO = 'ls -lnd "$1" 2>/dev/null || exit 1; file -b "$1" 2>/dev/null';
// A copy of $2 (on machine $1, "" for this one) at $3.
const COPY = 'mkdir -p "${3%/*}" && { if [ -n "$1" ]; then hc exec --on "$1" cat "$2"; else cat "$2"; fi; } > "$3.part" && mv "$3.part" "$3"';
// A picture of $1 at $2, $3 px wide.
// $1's first $4 pages as $2-NNN.png, $3 px wide (pdftoppm, else pdfpages.swift built at $5);
// prints "file width height" for each.
const PAGES = 'if ! ls "$2"-*.png >/dev/null 2>&1; then mkdir -p "${2%/*}" || exit 1; if command -v pdftoppm >/dev/null 2>&1; then pdftoppm -png -scale-to-x "$3" -scale-to-y -1 -l "$4" "$1" "$2" || exit 1; else b="${2%/*}/pdfpages"; [ -x "$b" ] || swiftc -O -o "$b" "$5" >/dev/null 2>&1 || exit 1; "$b" "$1" "$2" "$3" "$4" || exit 1; fi; fi; for f in "$2"-*.png; do echo "$f $(file -b "$f" | sed -n "s/.*, \\([0-9]*\\) x \\([0-9]*\\),.*/\\1 \\2/p")"; done';
const THUMB = 'd=$(mktemp -d) || exit 1; f=; if command -v qlmanage >/dev/null; then qlmanage -t -s "$3" -o "$d" "$1" >/dev/null 2>&1; f="$d/${1##*/}.png"; elif [ "${1##*.}" = pdf ] && command -v pdftoppm >/dev/null; then pdftoppm -png -singlefile -scale-to "$3" "$1" "$d/t" >/dev/null 2>&1; f="$d/t.png"; elif command -v ffmpeg >/dev/null; then ffmpeg -loglevel error -ss 1 -i "$1" -frames:v 1 -vf "scale=$3:-2" "$d/t.png" >/dev/null 2>&1; f="$d/t.png"; fi; [ -s "$f" ] && mkdir -p "${2%/*}" && mv "$f" "$2"; s=$?; rm -rf "$d"; exit $s';

function hash(s) {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { a = (a * 33 + s.charCodeAt(i)) >>> 0; b = (b * 31 ^ s.charCodeAt(i)) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const human = (n) => n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : n < 1 << 30 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
const exists = (rel) => exec("test", ["-s", `${appHome()}/${rel}`]).then((r) => r.code === 0).catch(() => false);

export default class Preview extends View {
  init(_p, cx) {
    this.key = null; this.view = null; this.meta = null; this.code = null; this.zoom = 1; this.size = { width: 600, height: 400 };
    // Copies and thumbnails left alone for a week go.
    cx.spawn(async () => {
      await exec("sh", ["-c", 'mkdir -p "$1" && find "$1" -type f -mtime +7 -delete', "preview", `${appHome()}/${CACHE}`]).catch(() => null);
    });
  }

  async close() {
    if (props()?.follow) setShared("neotree.preview", null);
    this.code?.release();
  }

  spec() {
    const p = props() ?? {};
    return p.follow ? shared("neotree.preview") : p;
  }

  // A copy here, as a path image() takes; files on this machine copy too, so a
  // changed file gets a new name and isn't served from the image cache.
  async local(file, on, id, ext, size) {
    const rel = `${CACHE}/${id}.${ext || "bin"}`;
    if (await exists(rel)) return rel;
    if (on && size > FETCH_MAX) throw new Error(`Too big to copy from ${on} for a preview (${human(size)})`);
    const r = await exec("sh", ["-c", COPY, "preview", on ?? "", file, `${appHome()}/${rel}`]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot copy this file");
    return rel;
  }

  load(spec, key, cx) {
    this.key = key; this.view = null; this.meta = null; this.zoom = ZOOMS.includes(spec?.zoom) ? spec.zoom : 1;
    this.code?.release(); this.code = null;
    if (!spec?.file) return;
    const file = spec.file, on = spec.on ?? null, name = file.split("/").pop();
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    cx.spawn(async (cx) => {
      const show = (view) => {
        if (this.key !== key) return;
        this.view = view;
        cx.notify();
      };
      try {
        const info = await exec("sh", ["-c", INFO, "preview", file], { on });
        if (this.key !== key) return;
        if (info.code !== 0) return show({ type: "info", text: "This file is no longer there" });
        const [ls, kind = ""] = info.stdout.split("\n");
        const size = Number(ls.trim().split(/\s+/)[4]) || 0, id = hash(`${on}\0${ls}`);
        this.meta = { size, kind: kind.trim() };
        if (/directory/.test(kind)) return show({ type: "info", text: "A folder" });
        const dims = kind.match(/(\d+)\s*x\s*(\d+)/);
        if (IMAGE.has(ext)) return show({ type: "image", path: await this.local(file, on, id, ext, size), w: Number(dims?.[1]) || 0, h: Number(dims?.[2]) || 0 });
        if (ext === "pdf") {
          const src = on ? `${appHome()}/${await this.local(file, on, id, ext, size)}` : file;
          show({ type: "info", text: "Rendering pages…" });
          const r = await exec("sh", ["-c", PAGES, "preview", src, `${appHome()}/${CACHE}/${id}.page`, String(PAGE_PX), String(PAGES_MAX), `${appHome()}/mods/preview/pdfpages.swift`]);
          const pages = r.stdout.split("\n").map((l) => l.split(" ")).filter((f) => f.length >= 3 && Number(f.at(-1)) > 0)
            .map((f) => ({ path: f.slice(0, -2).join(" ").slice(appHome().length + 1), w: Number(f.at(-2)), h: Number(f.at(-1)) }));
          if (pages.length) return show({ type: "pdf", pages });
        }

        const texty = MARKDOWN.has(ext) || HTML.has(ext) || /text|json|script|empty|xml/i.test(kind);
        if (texty) {
          if (size > TEXT_MAX) return show({ type: "info", text: `Too big to preview as text (${human(size)})` });
          const text = await readTextFile(file, { on });
          if (this.key !== key) return;
          if (text === null) return show({ type: "info", text: "This file is no longer there" });
          if (!text.includes("\0")) {
            if (MARKDOWN.has(ext)) return show({ type: "markdown", text, id });
            if (HTML.has(ext)) return show({ type: "html", text, id });
            const t = theme();
            this.code = EditorState.new({ language: LANG[ext] ?? (ext || "txt"), readonly: true, value: text,
              font_family: settings().font_family, font_size: 12,
              syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
            return show({ type: "code" });
          }
        }

        // Anything else gets a thumbnail, if this machine can make one.
        const png = `${CACHE}/${id}.thumb.png`;
        if (!(await exists(png))) {
          const src = on ? `${appHome()}/${await this.local(file, on, id, ext, size)}` : file;
          const r = await exec("sh", ["-c", THUMB, "preview", src, `${appHome()}/${png}`, String(THUMB_PX)]);
          if (r.code !== 0) return show({ type: "info", text: `No preview for ${kind.trim() || "this file"}` });
        }
        show({ type: "image", path: png });
      } catch (e) {
        show({ type: "info", text: String(e?.message ?? e) });
      }
    });
  }

  zoomBy(step) {
    this.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(this.zoom) + step))];
  }

  // A button in the header; it doesn't start a drag of the floating window.
  button(id, label, t, act) {
    return div().id(id).px(5).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { act(); cx.notify(); }).child(label);
  }

  // The image at zoom × the size that fits the pane, scrolled when bigger.
  zoomed(v) {
    const W = Math.max(50, this.size.width - 16), H = Math.max(50, this.size.height - 40);
    const fit = v.w && v.h ? Math.min(W / v.w, H / v.h) : 1, w = (v.w ? v.w * fit : W) * this.zoom, h = (v.h ? v.h * fit : H) * this.zoom;
    return image(v.path).flex_none().w(w).h(h);
  }

  render(cx) {
    const t = theme(), spec = this.spec(), follow = Boolean(props()?.follow);
    const key = spec?.file ? JSON.stringify([spec.on ?? null, spec.file]) : null;
    if (key !== this.key) this.load(spec, key, cx);
    const v = this.view, m = this.meta;

    const header = h_flex().h(24).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().flex_none().max_w(320).truncate().font_bold().child(spec?.file?.split("/").pop() ?? "Preview"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(m ? `${human(m.size)} · ${v?.type === "pdf" ? `${v.pages.length}${v.pages.length === PAGES_MAX ? "+" : ""} pages · ` : ""}${m.kind}` : spec?.on ?? ""))
      .when(v?.type === "image" || v?.type === "pdf", (el) => el.child(h_flex().flex_none().gap(2).text_color(t.muted)
        .child(this.button("preview-out", "−", t, () => this.zoomBy(-1)))
        .child(this.button("preview-fit", this.zoom === 1 ? "fit" : `${this.zoom * 100}%`, t, () => { this.zoom = 1; }))
        .child(this.button("preview-in", "+", t, () => this.zoomBy(1)))))
      .when(follow, (el) => el.child(div().id("preview-close").flex_none().px(4).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => { setShared("neotree.preview", null); closeOverlay(props().overlay); })
        .child("×")));

    const body = !v
      ? div().flex_1().p(12).text_color(t.dim).child(spec?.file ? "Loading…" : "Move the tree's cursor onto a file")
      : v.type === "image"
        ? this.zoom === 1
          ? div().flex_1().min_h(0).p(8).flex().items_center().justify_center().child(image(v.path).size_full())
          : div().id("preview-zoomed").flex_1().min_h(0).p(8).overflow_scroll().child(this.zoomed(v))
        : v.type === "pdf"
          ? div().id("preview-pages").flex_1().min_h(0).p(8).overflow_scroll()
            .child(v_flex().gap(8).items_center().children(v.pages.map((pg) => {
              const w = Math.max(100, this.size.width - 24) * this.zoom;
              return image(pg.path).flex_none().w(w).h((w * pg.h) / pg.w);
            })))
        : v.type === "markdown" || v.type === "html"
          ? div().flex_1().min_h(0).px(14).py(8)
            .child((v.type === "markdown" ? TextView.markdown(`preview-${v.id}`, v.text) : TextView.html(`preview-${v.id}`, v.text)).scrollable(true).selectable(true).size_full())
          : v.type === "code"
            ? Editor.new(this.code).flex_1().min_h(0)
            : div().flex_1().p(12).text_color(t.dim).child(v.text);

    return v_flex().id("root").on_size_change((size, cx) => { this.size = size; cx.notify(); }).size_full().overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body);
  }
}
