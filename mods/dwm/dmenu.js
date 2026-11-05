import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, exec, notify, props, closeOverlay } from "herdr";
import { BH, PAD, FONT, schemes, spawn, lightsPad } from "./bar.js";

// dmenu_path: every executable on $PATH, by name.
const PATH = 'IFS=:; for d in $PATH; do for f in "$d"/*; do [ -f "$f" ] && [ -x "$f" ] && echo "${f##*/}"; done; done | sort -u';

// TEXTW for paging: the layout's ui_font is JetBrains Mono, 0.6 em per glyph.
const textw = (s) => s.length * FONT * 0.6 + 2 * PAD;

export default class Dmenu {
  init(_p, cx) {
    this.items = [];
    this.text = "";
    this.mw = 0;
    this.match();
    this.focus = cx.focus_handle();
    this.focus.focus();
    const on = spaces().find((s) => s.active)?.machine ?? null;
    cx.spawn(async (cx) => {
      try {
        this.items = (await exec("sh", ["-c", PATH], { on })).stdout.split("\n").filter(Boolean);
      } catch (e) {
        notify({ title: "dmenu", body: String(e), level: "error" });
      }
      this.match();
      cx.notify();
    });
  }

  // Every token must match; exact matches first, then prefixes, then substrings.
  match() {
    const toks = this.text.split(" ").filter(Boolean);
    const exact = [], prefix = [], sub = [];
    for (const it of this.items) {
      if (!toks.every((k) => it.includes(k))) continue;
      if (!toks.length || it === this.text) exact.push(it);
      else if (it.startsWith(toks[0])) prefix.push(it);
      else sub.push(it);
    }
    this.matches = exact.concat(prefix, sub);
    this.sel = this.curr = 0;
  }

  room() {
    return this.mw ? this.mw - (lightsPad() + Math.floor(this.mw / 3) + textw("<") + textw(">")) : Infinity;
  }

  next(i) {
    const n = this.room();
    for (let w = 0; i < this.matches.length; i++) if ((w += Math.min(textw(this.matches[i]), n)) > n) break;
    return i;
  }

  prev(i) {
    const n = this.room();
    for (let w = 0; i > 0; i--) if ((w += Math.min(textw(this.matches[i - 1]), n)) > n) break;
    return i;
  }

  close() {
    closeOverlay(props().overlay);
  }

  run(cmd) {
    this.close();
    if (cmd.trim()) spawn(["sh", "-c", 'exec "${SHELL:-/bin/sh}" -c "$1"', "sh", cmd]);
  }

  key(e, cx) {
    const k = e.key;
    const m = e.modifiers ?? {};
    if (k === "escape") return this.close();
    if (k === "enter") return this.run(m.shift ? this.text : this.matches[this.sel] ?? this.text);
    if (k === "tab") {
      if (this.matches[this.sel]) this.text = this.matches[this.sel];
      this.match();
    } else if (k === "backspace") {
      this.text = [...this.text].slice(0, -1).join("");
      this.match();
    } else if (m.control && k === "u") {
      this.text = "";
      this.match();
    } else if (m.control && k === "w") {
      this.text = this.text.replace(/\S*\s*$/, "");
      this.match();
    } else if (k === "left" || k === "up") {
      if (this.sel > 0 && --this.sel < this.curr) this.curr = this.prev(this.curr);
    } else if (k === "right" || k === "down") {
      if (this.sel < this.matches.length - 1 && ++this.sel >= this.next(this.curr)) this.curr = this.next(this.curr);
    } else if (e.key_char && !m.control && !m.alt && !m.platform) {
      this.text += e.key_char;
      this.match();
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const { norm, sel } = schemes(theme());
    const end = this.next(this.curr);
    const lp = lightsPad();
    const cell = (text, sc) => div().flex_none().h_full().px(PAD).flex().items_center().bg(sc.bg).text_color(sc.fg).child(text);
    const input = h_flex().h_full().px(PAD).items_center().text_color(norm.fg)
      .when(this.matches.length > 0, (el) => el.flex_none().w(Math.floor(this.mw / 3)))
      .when(!this.matches.length, (el) => el.flex_1())
      .child(this.text.replace(/ /g, " "))
      .child(div().flex_none().w(2).h(BH - 4).bg(norm.fg));
    return h_flex()
      .id("root")
      .track_focus(this.focus)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => {
        this.mw = size.width;
        cx.notify();
      })
      .w_full()
      .h(BH)
      .overflow_hidden()
      .bg(norm.bg)
      .text_size(FONT)
      .when(lp > 0, (el) => el.child(div().flex_none().w(lp).h_full()))
      .child(input)
      .when(this.matches.length > 0, (el) =>
        el
          .child(cell(this.curr > 0 ? "<" : "", norm).w(textw("<")))
          .children(this.matches.slice(this.curr, end).map((it, j) => cell(it, this.curr + j === this.sel ? sel : norm)))
          .child(div().flex_1())
          .when(end < this.matches.length, (el) => el.child(cell(">", norm))),
      );
  }
}
