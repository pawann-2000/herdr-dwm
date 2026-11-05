// Klondike in a floating window, drawn like an old X11 program on a dwm desktop:
// a 1px dwm border, flat grey button and status rows, pixel-art cards on felt
// (px/make.py draws the art; U screen pixels per art pixel, 2 unless resized).
// The rules and the click/drag handling follow mods/win98/sol.js.
// Opened with mod.open:solitaire; the game is kept in shared("solitaire.game").

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, shared, setShared, closeOverlay, settings } from "herdr";

const FELT = "#16912a", SPOT = "#0b5e18", BORDER = "#005577", GREY = "#d9d9d9", RED = "#e3241b", INK = "#111111";
const SCALES = { min: 1, max: 4, step: 0.5 }, GRIP = 14, BAR = 26, STATUS = 20;
// Where 2 to 10 put their pips: [column, row from 0 at the top to 1 at the bottom].
const PIPS = {
  2: [[1, 0], [1, 1]], 3: [[1, 0], [1, 0.5], [1, 1]],
  4: [[0, 0], [2, 0], [0, 1], [2, 1]], 5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  9: [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  10: [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};
// In art pixels on the 36 x 50 card: the pips' left edges, and their first and last rows.
const PIP_X = [10, 14.5, 19], PIP_TOP = 7, PIP_SPAN = 29;
const HELP = "Build each suit from A to K on the four piles top right. Build the columns down in alternating colours; only a K fills an empty column. Click a card, then where it goes, or drag it. Double-click sends a card home. Drag the corner grip, or press + and -, to resize.\n\nn new · u undo · d draw 1/3 · a auto-finish · ? help · q quit";

// Everything on the table is in art pixels times U. Herdr's zoom scales what a mod draws,
// so U is the chosen screen pixels per art pixel divided by it, as Herdr 98 does: an art
// pixel stays a whole number of screen pixels. Resizing changes the chosen size.
let U, CW, CH, GAP, PAD, TOP, TAB, W, H, FAN, HIDDEN, WASTE;
function size(u, zoom = 1) {
  U = u / zoom; CW = 36 * U; CH = 50 * U; GAP = 5 * U; PAD = 6 * U; TOP = 6 * U; TAB = TOP + CH + 9 * U;
  W = PAD * 2 + 7 * CW + 6 * GAP; H = 250 * U; FAN = 10 * U; HIDDEN = 4 * U; WASTE = 12 * U;
}
size(2);

// A piece of art at x, y, w, h art pixels: image() keeps its colours, svg() takes the text colour.
const px = (name, x, y, w, h, color = false) => (color ? image : svg)(`mods/solitaire/px/${name}.svg`).absolute().left(x * U).top(y * U).w(w * U).h(h * U);
// Where a pointer event is in an element w x h layout px big. An event's position and its
// element's bounds share one space, but in a floating window that space isn't layout px,
// so the element's known size sets the scale.
const inside = (e, w, h) => (e.bounds?.width ? { x: ((e.position.x - e.bounds.x) * w) / e.bounds.width, y: ((e.position.y - e.bounds.y) * h) / e.bounds.height } : null);

const rank = (c) => (c % 13) + 1;
const suit = (c) => Math.floor(c / 13);
const red = (c) => suit(c) < 2;
const copy = (x) => JSON.parse(JSON.stringify(x));
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const snap = (u) => Math.min(SCALES.max, Math.max(SCALES.min, Math.round(u / SCALES.step) * SCALES.step));

export default class Solitaire extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.u = snap(Number(shared("solitaire.scale")) || 2); this.z = Number(settings()?.zoom) || 1;
    size(this.u, this.z);
    this.draw = shared("solitaire.draw") ?? 3;
    const saved = shared("solitaire.game");
    if (saved?.g && !saved.won) Object.assign(this, { g: saved.g, seconds: saved.seconds, moves: saved.moves, won: false, history: [], pick: null, press: null, drag: null });
    else this.deal();
    this.help = false; this.resizing = null;
    if (this.moves) this.begin(cx);
  }

  async close() {
    this.timer?.cancel();
  }

  deal() {
    this.timer?.cancel(); this.timer = null;
    const cards = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.g = { stock: cards, waste: [], tab: [], home: [[], [], [], []], score: 0 };
    for (let i = 0; i < 7; i++) this.g.tab.push(cards.splice(0, i + 1).map((c, j) => ({ c, up: j === i })));
    this.seconds = 0; this.moves = 0; this.won = false; this.history = [];
    this.pick = this.press = this.drag = null;
    this.keep();
  }

  keep() {
    setShared("solitaire.game", { g: this.g, seconds: this.seconds, moves: this.moves, won: this.won });
  }

  begin(cx) {
    if (this.won || this.timer) return;
    this.timer = cx.timer.every(1000, (cx) => {
      this.seconds++;
      if (this.seconds % 10 === 0) { this.g.score -= 2; this.keep(); }
      cx.notify();
    });
  }

  // Before every change: undo goes back one change.
  save(cx) {
    this.history.push(copy(this.g));
    if (this.history.length > 100) this.history.shift();
    this.moves++;
    this.begin(cx);
  }

  pile(loc) {
    return loc.type === "tab" ? this.g.tab[loc.i] : loc.type === "home" ? this.g.home[loc.i] : this.g.waste;
  }

  cards(loc) {
    return this.pile(loc).slice(loc.n).map((c) => (typeof c === "number" ? c : c.c));
  }

  validPick(loc) {
    const p = this.pile(loc);
    if (loc.n < 0 || !p.length) return false;
    if (loc.type !== "tab") return loc.n === p.length - 1;
    if (!p[loc.n].up) return false;
    for (let j = loc.n + 1; j < p.length; j++) {
      if (!p[j].up || red(p[j].c) === red(p[j - 1].c) || rank(p[j].c) + 1 !== rank(p[j - 1].c)) return false;
    }
    return true;
  }

  move(from, to, cx) {
    if (!from || !this.validPick(from) || (from.type === to.type && (from.i === to.i || to.type === "home"))) return false;
    const cards = this.cards(from), c = cards[0], dest = this.pile(to), last = dest[dest.length - 1];
    if (to.type === "home") {
      if (cards.length !== 1 || rank(c) !== dest.length + 1 || (last !== undefined && suit(last) !== suit(c))) return false;
    } else if (to.type === "tab") {
      if (!last ? rank(c) !== 13 : !last.up || red(last.c) === red(c) || rank(last.c) !== rank(c) + 1) return false;
    } else return false;
    this.save(cx);
    this.pile(from).splice(from.n);
    dest.push(...(to.type === "tab" ? cards.map((c) => ({ c, up: true })) : cards));
    this.g.score += to.type === "home" ? 10 : from.type === "home" ? -15 : from.type === "waste" ? 5 : 0;
    this.pick = this.press = this.drag = null;
    if (this.g.home.every((p) => p.length === 13)) { this.won = true; this.timer?.cancel(); this.timer = null; }
    this.keep();
    return true;
  }

  home(loc, cx) {
    if (!this.validPick(loc) || this.cards(loc).length !== 1) return false;
    for (let i = 0; i < 4; i++) if (this.move(loc, { type: "home", i }, cx)) return true;
    return false;
  }

  // Sends every card that can go home there, until none can.
  auto(cx) {
    let moved = true;
    while (moved && !this.won) {
      moved = this.home({ type: "waste", i: 0, n: this.g.waste.length - 1 }, cx);
      for (let i = 0; i < 7 && !moved; i++) moved = this.home({ type: "tab", i, n: this.g.tab[i].length - 1 }, cx);
    }
  }

  stock(cx) {
    if (this.won || (!this.g.stock.length && !this.g.waste.length)) return;
    this.save(cx); this.pick = null;
    if (this.g.stock.length) {
      for (let i = 0; i < this.draw && this.g.stock.length; i++) this.g.waste.push(this.g.stock.pop());
    } else {
      this.g.stock = this.g.waste.reverse(); this.g.waste = [];
      this.g.score -= this.draw === 1 ? 100 : 20;
    }
    this.keep();
  }

  undo() {
    if (!this.history.length || this.won) return;
    this.g = this.history.pop();
    this.pick = this.press = this.drag = null;
    this.keep();
  }

  // A press on the card at x, y on the table: where on the card it landed is kept, so a
  // dragged card stays under the pointer exactly where it was picked up.
  down(loc, e, cx) {
    cx.stop_propagation();
    this.handle.focus();
    if (this.pick && this.move(this.pick, loc, cx)) return cx.notify();
    const p = this.pile(loc);
    if (loc.type === "tab" && p[loc.n] && !p[loc.n].up) {
      if (loc.n === p.length - 1) { this.save(cx); p[loc.n].up = true; this.g.score += 5; this.keep(); }
      return cx.notify();
    }
    if (!this.validPick(loc)) { this.pick = null; return cx.notify(); }
    const grab = inside(e, CW, CH) ?? { x: CW / 2, y: CH / 4 };
    this.press = { loc, x: e.position.x, y: e.position.y, dx: grab.x, dy: grab.y };
    cx.notify();
  }

  // The pile under the middle of the card being dragged.
  target(x, y) {
    if (y < TAB - GAP) {
      for (let i = 0; i < 4; i++) { const left = PAD + (3 + i) * (CW + GAP); if (x >= left - GAP / 2 && x <= left + CW + GAP / 2) return { type: "home", i }; }
      return null;
    }
    const i = Math.floor((x - PAD + GAP / 2) / (CW + GAP));
    return i >= 0 && i < 7 ? { type: "tab", i } : null;
  }

  resize(u) {
    const next = snap(u);
    if (next === this.u) return;
    this.u = next;
    size(this.u, this.z);
    this.drag = null;
    setShared("solitaire.scale", this.u);
  }

  key(e, cx) {
    const k = e.key_char ?? e.key, m = e.modifiers ?? {};
    if (m.platform || m.alt || m.control) return;
    if (this.help && k !== "?") this.help = false;
    else if (k === "n") this.deal();
    else if (k === "u") this.undo();
    else if (k === "d") { this.draw = this.draw === 3 ? 1 : 3; setShared("solitaire.draw", this.draw); }
    else if (k === "a") this.auto(cx);
    else if (k === "+" || k === "=") this.resize(this.u + SCALES.step);
    else if (k === "-") this.resize(this.u - SCALES.step);
    else if (k === "?") this.help = !this.help;
    else if (k === "q" || e.key === "escape") return closeOverlay(props()?.overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // The card in pixel art: indices in two corners (the lower one upside down), then pips,
  // a big ace, or the court figure, drawn twice head to toe.
  card(c, up, selected) {
    const box = div().relative().w(CW).h(CH).flex_none();
    if (!up) return box.child(px("back", 0, 0, 36, 50, true));
    const r = rank(c), s = suit(c), rw = r === 10 ? 8 : 5;
    box.text_color(red(c) ? RED : INK).child(px("card", 0, 0, 36, 50, true))
      .child(px(`r${r}`, 2, 2, rw, 7)).child(px(`s${s}-5`, 2, 10, 5, 5))
      .child(px(`r${r}f`, 34 - rw, 41, rw, 7)).child(px(`s${s}-5f`, 29, 35, 5, 5));
    if (r === 1) box.child(px(`s${s}-9`, 9, 16, 18, 18));
    else if (r > 10) box.child(px(`court${r}-${red(c) ? "r" : "b"}`, 9, 7, 18, 36, true));
    else for (const [col, row] of PIPS[r]) box.child(px(`s${s}-7${row > 0.5 ? "f" : ""}`, PIP_X[col], PIP_TOP + row * PIP_SPAN, 7, 7));
    if (selected) box.child(div().absolute().left(U).top(U).w(CW - 2 * U).h(CH - 2 * U).bg("#3d8bfd33").border_1().border_color("#1f6fd6"));
    return box;
  }

  // A flat Athena-style button: black outline, grey face.
  button(id, text, on, act) {
    return div().id(id).h(18).px(8).flex().items_center().border_1().border_color("#000000").bg(GREY)
      .text_color(on ? "#000000" : "#8a8a8a").when(on, (el) => el.cursor_pointer().hover((s) => s.bg("#ececec")))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (on) { act(cx); cx.notify(); } })
      .child(text);
  }

  // The bottom-right corner grip: three ridges, as X11 programs drew them.
  grip() {
    const ridge = (n) => div().absolute().right(2).bottom(2 + n * 4).w(2 + n * 4).h(1).bg("#6f6f6f");
    return div().id("sol-grip").relative().w(GRIP).h(GRIP).flex_none().cursor_pointer()
      .children([0, 1, 2].map(ridge))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        // Event px per layout px, from the grip's own size.
        const k = e.bounds?.width ? GRIP / e.bounds.width : 1;
        this.resizing = { x: e.position.x, y: e.position.y, k, u: this.u, w: W + 2, h: H + BAR + STATUS + 2 };
        cx.notify();
      });
  }

  render(cx) {
    const z = Number(settings()?.zoom) || 1;
    if (z !== this.z) { this.z = z; size(this.u, z); }
    const g = this.g;
    const table = div().id("sol-table").relative().w(W).h(H).flex_none().bg(FELT).overflow_hidden()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
      .on_hover((hovered, cx) => { if (!hovered && this.press) { this.press = this.drag = null; cx.notify(); } })
      .on_mouse_move((e, cx) => {
        if (!this.press) return;
        if (!this.drag && Math.abs(e.position.x - this.press.x) + Math.abs(e.position.y - this.press.y) <= 4) return;
        const at = inside(e, W, H);
        if (!at) return;
        this.drag = { x: at.x - this.press.dx, y: at.y - this.press.dy };
        this.pick = null;
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        if (!this.press) return;
        const from = this.press.loc;
        if (this.drag) {
          const to = this.target(this.drag.x + CW / 2, this.drag.y + Math.min(CH / 2, FAN * 2));
          if (to) this.move(from, to, cx);
          this.pick = null;
        } else this.pick = this.pick && JSON.stringify(this.pick) === JSON.stringify(from) ? null : from;
        this.press = this.drag = null;
        cx.notify();
      });

    table.child(image("mods/solitaire/px/felt.svg").absolute().left(0).top(0).w(W).h(H));
    const spot = (x, y) => div().absolute().left(x).top(y).w(CW).h(CH).rounded(2 * U).border(U).border_color(SPOT);
    const add = (loc, c, x, y, up = true) => {
      if (this.drag && this.press && this.press.loc.type === loc.type && this.press.loc.i === loc.i && loc.n >= this.press.loc.n) return;
      const selected = this.pick && this.pick.type === loc.type && this.pick.i === loc.i && loc.n >= this.pick.n;
      table.child(this.card(c, up, selected).absolute().left(x).top(y).id(`sol-${loc.type}-${loc.i}-${loc.n}`)
        .on_mouse_down("left", (e, cx) => this.down(loc, e, cx))
        .on_click((e, cx) => {
          cx.stop_propagation();
          if (e.click_count >= 2 && up) { this.press = this.pick = null; this.home(loc, cx); cx.notify(); }
        }));
    };

    // The stock shows its thickness: a back card for every eight left, offset like a real deck's edge.
    const layers = Math.min(3, Math.ceil(g.stock.length / 8));
    for (let k = layers - 1; k > 0; k--) table.child(this.card(0, false, false).absolute().left(PAD + k * U).top(TOP + k * U));
    table.child(spot(PAD, TOP).id("sol-stock").cursor_pointer()
      .when(g.stock.length > 0, (el) => el.border_color("#00000000").child(this.card(0, false, false).absolute().left(-U).top(-U)))
      .when(!g.stock.length, (el) => el.text_color(SPOT).child(px("ring", 12.5, 19.5, 9, 9)))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); this.stock(cx); cx.notify(); }));
    const shown = Math.min(this.draw, g.waste.length);
    for (let j = g.waste.length - shown; j < g.waste.length; j++) {
      add({ type: "waste", i: 0, n: j }, g.waste[j], PAD + CW + GAP + (j - g.waste.length + shown) * WASTE, TOP);
    }
    for (let i = 0; i < 4; i++) {
      const p = g.home[i], loc = { type: "home", i, n: p.length - 1 }, x = PAD + (3 + i) * (CW + GAP);
      table.child(spot(x, TOP).id(`sol-home-${i}`).text_color(SPOT).child(px(`s${i}-9`, 12.5, 19.5, 9, 9))
        .on_mouse_down("left", (e, cx) => this.down(loc, e, cx)));
      if (p.length) add(loc, p[p.length - 1], x, TOP);
    }
    for (let i = 0; i < 7; i++) {
      const p = g.tab[i], x = PAD + i * (CW + GAP), up = p.filter((c) => c.up).length;
      table.child(spot(x, TAB).id(`sol-tab-${i}`).on_mouse_down("left", (e, cx) => this.down({ type: "tab", i, n: 0 }, e, cx)));
      const step = Math.min(FAN, (H - TAB - CH - (p.length - up) * HIDDEN) / Math.max(1, up - 1));
      let y = TAB;
      p.forEach((c, n) => { add({ type: "tab", i, n }, c.c, x, y, c.up); y += c.up ? Math.max(5, step) : HIDDEN; });
    }
    if (this.drag && this.press) {
      this.cards(this.press.loc).forEach((c, i) => table.child(this.card(c, true, false).absolute().left(this.drag.x).top(this.drag.y + i * FAN)));
    }
    if (this.won || this.help) {
      table.child(div().absolute().left(20 * U).right(20 * U).top(75 * U).p(12).bg(GREY).border_1().border_color("#000000").text_color("#000000").text_size(12)
        .child(this.won ? `You won in ${clock(this.seconds)}, ${this.moves} moves, ${g.score} points.\n\nn for a new game.` : HELP));
    }

    const bar = h_flex().h(BAR).flex_none().px(6).gap(6).items_center().bg(GREY).border_b(1).border_color("#000000")
      .child(this.button("sol-new", "New", true, () => this.deal()))
      .child(this.button("sol-undo", "Undo", this.history.length > 0 && !this.won, () => this.undo()))
      .child(this.button("sol-draw", `Draw ${this.draw}`, true, () => { this.draw = this.draw === 3 ? 1 : 3; setShared("solitaire.draw", this.draw); }))
      .child(this.button("sol-auto", "Auto", !this.won, (cx) => this.auto(cx)))
      .child(div().flex_1())
      .child(this.button("sol-help", "?", true, () => { this.help = !this.help; }))
      .child(this.button("sol-quit", "Quit", true, () => closeOverlay(props()?.overlay)));

    const cell = (text) => div().px(8).border_r(1).border_color("#8a8a8a").child(text);
    const status = h_flex().h(STATUS).flex_none().items_center().bg(GREY).border_t(1).border_color("#000000").text_size(11).text_color("#000000")
      .child(cell(`Score ${g.score}`)).child(cell(`Time ${clock(this.seconds)}`)).child(cell(`Moves ${this.moves}`))
      .child(cell(`Stock ${g.stock.length}`)).child(div().flex_1().px(8).text_color("#4a4a4a").child(this.won ? "won" : this.draw === 3 ? "draw three" : "draw one"))
      .child(this.grip());

    const game = v_flex().w(W + 2).flex_none().border_1().border_color(BORDER).bg(FELT).text_size(12)
      .child(bar).child(table).child(status);

    // While the grip is held, a clear margin keeps the pointer over this window when it is
    // pulled past the edge: the window only hears the pointer while it is over the window.
    const end = (cx) => { if (this.resizing) { this.resizing = null; cx.notify(); } };
    return div().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .flex_none().when(Boolean(this.resizing), (el) => el.pr(400).pb(400))
      .on_mouse_move((e, cx) => {
        const r = this.resizing;
        if (!r) return;
        const dx = (e.position.x - r.x) * r.k, dy = (e.position.y - r.y) * r.k;
        const before = this.u;
        this.resize(r.u * (1 + Math.max(dx / r.w, dy / r.h)));
        if (this.u !== before) cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => end(cx))
      .on_hover((hovered, cx) => { if (!hovered) end(cx); })
      .child(game);
  }
}
