// Glass: how see-through the layout is, and what shows behind it. A floating window
// (mod.open:glass, ⌘K T).
// - Panels: the bar, tree, sessions, preview and browser paint their fills with this
//   alpha (./tint.js reads shared("glass")), live while the slider moves.
// - Terminals and the background are the shown layout's own look, written into
//   layouts/<name>.json: the root's "background" (a gradient, a picture in
//   backgrounds/, or the theme's) and "terminal_opacity". While terminals see
//   through, the tab block's pane "background" is "#00000000": Herdr fills panes
//   with the theme otherwise, and nothing behind them would show.
// Pictures dropped on the window, or picked with "add", are copied into backgrounds/.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Slider, SliderTrack, SliderIndicator, SliderThumb, SliderState } from "gpui-base";
import { exec, readTextFile, writeTextFile, appHome, layout, theme, props, shared, setShared, closeOverlay, watchFolder, notify } from "herdr";
import { panels } from "./tint.js";

const DIR = "backgrounds", FONT = 13, TW = 92, TH = 56, CLEAR = "#00000000";
// Herdr draws these as they are; heic, heif and avif are copied in as jpg.
const DRAWN = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;
const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|heic|heif|avif)$/i;
const GRADIENTS = [
  { name: "dwm", gradient: ["#005577", "#000000"], angle: 160 },
  { name: "night", gradient: ["#23305a", "#04060c"], angle: 180 },
  { name: "dusk", gradient: ["#6a2c5a", "#0c1838"], angle: 150 },
  { name: "moss", gradient: ["#2e5e3c", "#06110a"], angle: 165 },
  { name: "ember", gradient: ["#8a3417", "#140604"], angle: 155 },
  { name: "steel", gradient: ["#56616d", "#0e1114"], angle: 170 },
];
const HELP = [
  ["- / =", "panels less / more opaque"], ["[ / ]", "terminals less / more opaque"],
  ["← / →", "previous / next background"], ["f", "cover / contain a picture"],
  ["a", "add pictures"], ["o", "open the backgrounds folder"], ["0", "solid: no transparency"], ["esc", "close"],
];

// Lists the folder, making a small jpg of each picture once (sips on macOS, ImageMagick
// elsewhere; without either a tile shows the picture itself). Prints "name<tab>thumb?".
const LIST = [
  'd="$1"; mkdir -p "$d/.thumbs" && cd "$d" || exit 0',
  'for f in *; do',
  '  [ -f "$f" ] || continue',
  '  t=".thumbs/$f.jpg"',
  '  if [ ! -s "$t" ] || [ "$f" -nt "$t" ]; then',
  '    if command -v sips >/dev/null 2>&1; then sips -s format jpeg -Z 256 "$f" --out "$t" >/dev/null 2>&1',
  '    elif command -v magick >/dev/null 2>&1; then magick "$f[0]" -thumbnail 256x256 "$t" 2>/dev/null',
  '    elif command -v convert >/dev/null 2>&1; then convert "$f[0]" -thumbnail 256x256 "$t" 2>/dev/null; fi',
  '  fi',
  '  if [ -s "$t" ]; then printf "%s\\t1\\n" "$f"; else printf "%s\\t0\\n" "$f"; fi',
  'done; exit 0',
].join("\n");
// Copies pictures in under a free name (the same picture again reuses its copy) and
// prints the names; heic, heif and avif become jpg (sips on macOS, else ImageMagick).
const ADD = [
  'd="$1"; shift; mkdir -p "$d" || exit 1; tmp="$d/.incoming.jpg"',
  'for f; do',
  '  [ -f "$f" ] || continue',
  '  b=$(basename "$f"); n="${b%.*}"; x="${b##*.}"; src="$f"',
  '  case "$(printf %s "$x" | tr A-Z a-z)" in heic|heif|avif)',
  '    x=jpg; src="$tmp"',
  '    { sips -s format jpeg "$f" --out "$tmp" || magick "$f" "$tmp"; } >/dev/null 2>&1 || continue ;;',
  '  esac',
  '  out="$n.$x"; i=2',
  '  while [ -e "$d/$out" ] && ! cmp -s "$src" "$d/$out"; do out="$n-$i.$x"; i=$((i+1)); done',
  '  [ -e "$d/$out" ] || cp "$src" "$d/$out" || continue',
  '  printf "%s\\n" "$out"',
  'done; rm -f "$tmp"; exit 0',
].join("\n");
// The system's file picker, left running in the background (exec stops after 30 s).
// The chosen paths land in $1, one per line; an empty file means cancelled.
const PICK = [
  'out="$1"; rm -f "$out"',
  '(',
  '  if [ "$(uname)" = Darwin ]; then',
  "    osascript -e 'activate' -e 'set o to \"\"' -e 'repeat with f in (choose file of type {\"public.image\"} with prompt \"Add backgrounds\" with multiple selections allowed)' -e 'set o to o & POSIX path of f & linefeed' -e 'end repeat' -e 'return o'",
  '  elif command -v zenity >/dev/null 2>&1; then zenity --file-selection --multiple --separator="|" --title="Add backgrounds"',
  '  elif command -v kdialog >/dev/null 2>&1; then kdialog --getopenfilename . "image/png image/jpeg image/webp image/gif" --multiple --separate-output',
  '  fi',
  '  ) >"$out.part" 2>/dev/null </dev/null && mv "$out.part" "$out" || : >"$out" &',
  'exit 0',
].join("\n");
const OPEN = 'mkdir -p "$1"; case "$(uname)" in Darwin) open "$1" ;; *) xdg-open "$1" >/dev/null 2>&1 & ;; esac';

const stop = (_e, cx) => cx.stop_propagation();

function walk(n, f) {
  f(n);
  for (const c of n.children ?? []) walk(c, f);
}

// Terminals: their opacity, and the panes clear behind them while it's below 1.
function setTerminals(tree, a) {
  tree.terminal_opacity = a;
  walk(tree, (n) => {
    if (n.content?.tab !== "active") return;
    const pane = (n.content.pane ??= {});
    if (a < 1) pane.background = CLEAR;
    else if (pane.background === CLEAR) pane.background = "background";
  });
}

function mix(a, b, k) {
  const at = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(at(a, i) + (at(b, i) - at(a, i)) * k).toString(16).padStart(2, "0")).join("");
}

// A gradient as bands: near enough at tile size, and bg() takes plain colors.
function bands([a, b], n = 14) {
  return v_flex().size_full().children(Array.from({ length: n }, (_, i) => div().w_full().flex_1().bg(mix(a, b, i / (n - 1)))));
}

export default class Glass extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.images = [];
    this.error = null;
    this.queue = Promise.resolve();
    this.watching = false;
    this.poller = null;
    this.panels = SliderState.new({ min: 0, max: 100, step: 5, value: Math.round(panels() * 100) });
    this.terms = SliderState.new({ min: 0, max: 100, step: 5, value: Math.round((this.root().terminal_opacity ?? 1) * 100) });
    this.panels.on("change", (v, cx) => { this.setPanels(v / 100); cx.notify(); });
    this.terms.on("change", (_v, cx) => cx.notify());
    this.terms.on("release", (v, cx) => this.edit(cx, (tree) => setTerminals(tree, v / 100)));
    setShared("cheatsheet.glass", { title: "Glass", hint: "in its window (⌘K T)", keys: HELP });
    this.list(cx);
  }

  dir() {
    return `${appHome()}/${DIR}`;
  }

  root() {
    return layout() ?? {};
  }

  // Not close(): Herdr calls a view's close() as cleanup.
  dismiss() {
    closeOverlay(props()?.overlay);
  }

  setPanels(a) {
    const g = shared("glass") ?? {};
    if (g.panels !== a) setShared("glass", { ...g, panels: a });
  }

  // Reads the shown layout's file, changes it and writes it back, one at a time.
  edit(cx, change) {
    const prev = this.queue;
    this.queue = new Promise((done) => cx.spawn(async (cx) => {
      await prev;
      try {
        const path = `${appHome()}/layouts/${shared("layout") ?? "dwm"}.json`;
        const text = await readTextFile(path);
        if (text == null) throw new Error(`there is no ${path}`);
        const tree = JSON.parse(text);
        change(tree);
        const next = JSON.stringify(tree, null, 2) + "\n";
        if (next !== text) await writeTextFile(path, next, text);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        done();
        cx.notify();
      }
    }));
  }

  choose(cx, background) {
    this.edit(cx, (tree) => { tree.background = background; });
  }

  solid(cx) {
    this.panels.set_value(100);
    this.terms.set_value(100);
    this.setPanels(1);
    this.edit(cx, (tree) => { setTerminals(tree, 1); tree.background = "background"; });
  }

  // Every background in the order the tiles show them, as layout values.
  choices() {
    const fit = this.root().background?.fit ?? "cover";
    return [
      { key: "theme", value: "background" },
      ...GRADIENTS.map((g) => ({ key: `grad:${g.name}`, value: { gradient: g.gradient, angle: g.angle }, g })),
      ...this.images.map((im) => ({ key: `img:${im.name}`, value: { image: `${DIR}/${im.name}`, fit }, im })),
    ];
  }

  current() {
    const b = this.root().background;
    if (b?.image) return `img:${String(b.image).replace(/^backgrounds\//, "")}`;
    if (b?.gradient) return `grad:${GRADIENTS.find((g) => g.gradient.join() === b.gradient.join())?.name ?? "?"}`;
    return "theme";
  }

  cycle(cx, d) {
    const all = this.choices(), i = all.findIndex((c) => c.key === this.current());
    this.choose(cx, all[(i + d + all.length) % all.length].value);
  }

  fit(cx) {
    const b = this.root().background;
    if (b?.image) this.choose(cx, { ...b, fit: b.fit === "contain" ? "cover" : "contain" });
  }

  list(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", LIST, "glass", this.dir()]).catch(() => null);
      this.images = (r?.stdout ?? "").split("\n").filter(Boolean).map((line) => {
        const [name, thumb] = line.split("\t");
        return { name, thumb: thumb === "1" ? `${DIR}/.thumbs/${name}.jpg` : `${DIR}/${name}` };
      }).filter((im) => DRAWN.test(im.name));
      cx.notify();
      // Pictures put in the folder from outside show up too.
      if (!this.watching) {
        this.watching = true;
        cx.spawn(async (cx) => {
          for (;;) {
            try { await watchFolder(this.dir()); } catch { return; }
            this.list(cx);
          }
        });
      }
    });
  }

  add(paths, cx) {
    const pics = paths.filter((p) => PICTURE.test(p));
    if (!pics.length) {
      if (paths.length) notify({ title: "Not a picture", body: "Backgrounds can be png, jpg, gif, webp, bmp, tiff, svg or heic.", level: "info" });
      return;
    }
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", ADD, "glass", this.dir(), ...pics]).catch((e) => ({ stdout: "", stderr: String(e) }));
      const names = (r.stdout ?? "").split("\n").filter(Boolean);
      if (!names.length) { this.error = `couldn't copy ${pics.length === 1 ? "the picture" : "the pictures"}`; cx.notify(); return; }
      this.choose(cx, { image: `${DIR}/${names.at(-1)}`, fit: this.root().background?.fit ?? "cover" });
      this.list(cx);
    });
  }

  pick(cx) {
    if (this.poller) return;
    const out = `${appHome()}/mods/glass/.cache/picked`;
    cx.spawn(async (cx) => {
      await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")"; ' + PICK, "glass", out]).catch(() => null);
      this.poller = cx.timer.every(400, (cx) => {
        readTextFile(out).then((text) => {
          if (text == null) return;
          this.poller?.cancel();
          this.poller = null;
          this.add(text.split(/[\n|]/).map((s) => s.trim()).filter(Boolean), cx);
          cx.notify();
        }).catch(() => null);
      });
      cx.notify();
    });
  }

  reveal() {
    exec("sh", ["-c", OPEN, "glass", this.dir()]).catch(() => null);
  }

  key(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    const k = e.key_char ?? e.key;
    const nudge = (s, d) => {
      const v = Math.min(100, Math.max(0, s.value() + d));
      s.set_value(v);
      return v / 100;
    };
    if (e.key === "escape" || k === "q") this.dismiss();
    else if (k === "-" || k === "=") this.setPanels(nudge(this.panels, k === "-" ? -5 : 5));
    else if (k === "[" || k === "]") { const a = nudge(this.terms, k === "[" ? -5 : 5); this.edit(cx, (tree) => setTerminals(tree, a)); }
    else if (e.key === "left" || k === "h") this.cycle(cx, -1);
    else if (e.key === "right" || k === "l") this.cycle(cx, 1);
    else if (k === "f") this.fit(cx);
    else if (k === "a") this.pick(cx);
    else if (k === "o") this.reveal();
    else if (k === "0") this.solid(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  slider(t, name, state) {
    return h_flex().h(22).gap(10).items_center()
      .child(div().w(76).flex_none().text_color(t.muted).child(name))
      .child(div().flex_1().min_w(0).on_mouse_down("left", stop).child(
        Slider.new(state).child(
          SliderTrack.new(state).flex().items_center().h(18).w_full().cursor_pointer().child(
            SliderIndicator.new(state).relative().w_full().h(4).bg(t.border)
              .range_style((fill) => fill.bg(t.accent))
              .child(SliderThumb.new(state).w(8).h(14).bg(t.foreground).ml(-4))))))
      .child(div().w(38).flex_none().text_right().child(`${state.value()}%`));
  }

  tile(t, c, cur) {
    const sel = c.key === cur;
    const name = c.g?.name ?? (c.key === "theme" ? "theme" : null);
    const face = c.im ? image(c.im.thumb).w(TW).h(TH) : c.g ? bands(c.g.gradient) : div().size_full().bg(t.background);
    return div().id(c.key).relative().flex_none().w(TW + 4).h(TH + 4).p(1).border_1()
      .border_color(sel ? t.accent : t.border).bg(sel ? t.accent : "#00000000").cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.choose(cx, c.value); cx.notify(); })
      .child(div().size_full().overflow_hidden().child(face))
      .when(Boolean(name), (el) => el.child(div().absolute().left(5).bottom(3).text_size(FONT - 2).text_color("#eeeeee").child(name)));
  }

  button(t, id, text, f) {
    return div().id(id).flex_none().px(6).h(18).flex().items_center().border_1().border_color(t.border).bg(t.chrome)
      .cursor_pointer().hover((s) => s.bg(t.raised)).on_mouse_down("left", stop).on_click((_e, cx) => { f(cx); cx.notify(); })
      .child(text);
  }

  render() {
    const t = theme(), cur = this.current(), b = this.root().background;
    const header = h_flex().h(22).flex_none().px(8).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().font_bold().child("glass"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${shared("layout") ?? "dwm"} layout`))
      .child(div().id("x").px(4).cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => this.dismiss()).child("×"));
    const fit = b?.image
      ? h_flex().gap(4).children(["cover", "contain"].map((f) =>
        div().id(`fit-${f}`).px(6).h(18).flex().items_center().border_1().border_color(t.border).cursor_pointer()
          .bg((b.fit ?? "cover") === f ? t.accent : t.chrome).text_color((b.fit ?? "cover") === f ? t.accent_foreground : t.foreground)
          .on_mouse_down("left", stop).on_click((_e, cx) => { this.choose(cx, { ...b, fit: f }); cx.notify(); }).child(f)))
      : null;
    const tiles = this.choices().map((c) => this.tile(t, c, cur));
    tiles.push(div().id("add").flex_none().w(TW + 4).h(TH + 4).border_1().border_color(t.border).cursor_pointer()
      .flex().flex_col().items_center().justify_center().gap(2).text_color(t.muted).hover((s) => s.text_color(t.foreground).border_color(t.accent))
      .on_mouse_down("left", stop).on_click((_e, cx) => this.pick(cx))
      .child(div().text_size(20).child("+")).child(div().text_size(FONT - 2).child(this.poller ? "picking…" : "add")));

    return v_flex().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_drop((e, cx) => this.add(e.paths ?? [], cx))
      .w_full().bg(t.background).text_color(t.foreground).text_size(FONT)
      .child(header)
      .child(v_flex().p(10).gap(8)
        .child(this.slider(t, "panels", this.panels))
        .child(this.slider(t, "terminals", this.terms))
        .child(h_flex().h(20).mt(2).gap(8).items_center()
          .child(div().flex_1().text_color(t.muted).child("background"))
          .when(Boolean(fit), (el) => el.child(fit)))
        .child(h_flex().flex_wrap().gap(6).children(tiles))
        .child(h_flex().gap(6).items_center().mt(2)
          .child(this.button(t, "folder", "open folder", () => this.reveal()))
          .child(this.button(t, "solid", "solid", (cx) => this.solid(cx)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).text_size(FONT - 1).child("or drop pictures here")))
        .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(FONT - 1).child(this.error))));
  }
}
