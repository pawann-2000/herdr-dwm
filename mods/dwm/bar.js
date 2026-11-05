import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, theme, run, nextCommand, window, layout, settings } from "herdr";

export const BH = 18;
export const PAD = 8;
export const FONT = 13;

// macOS draws its window buttons over the top strip at the layout's
// traffic_lights (screen points; the three span ~54 from x). Leave them that
// room in layout px, which scale with zoom. Linux, Windows, full screen: none.
const LIGHTS_W = 60;
export function lightsPad() {
  const w = window(), tl = layout()?.traffic_lights;
  if (w?.platform !== "macos" || w.titlebar !== "none" || w.fullscreen || !tl) return 0;
  return (tl[0] + LIGHTS_W) / (Number(settings().zoom) || 1);
}

export function schemes(t) {
  return {
    norm: { fg: t.foreground, bg: t.chrome },
    sel: { fg: t.accent_foreground, bg: t.accent },
  };
}

function shown() {
  const s = spaces().find((x) => x.active);
  const tab = s?.tabs.find((x) => x.active);
  return { s, tab, ps: tab ? panes().filter((p) => p.tab === tab.id) : [] };
}

// New clients go below the stack: the first split makes the master column.
export function spawn(argv) {
  const { tab, ps } = shown();
  if (!tab) return run("space.new", argv ? { argv } : {});
  const at = ps.length < 2 ? { direction: "right", pane: ps[0]?.pane } : { direction: "down", pane: ps[ps.length - 1].pane };
  run("pane.split", argv ? { ...at, argv } : at);
  if (tab.zoomed) run("pane.zoom");
}

const stop = (_e, cx) => cx.stop_propagation();

export default class Bar {
  init(_p, cx) {
    this.now = new Date();
    this.h = BH;
    this.views = {};
    const tick = (cx) => {
      this.now = new Date();
      cx.notify();
    };
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => {
      tick(cx);
      cx.timer.every(60000, tick);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand());
        cx.notify();
      }
    });
  }

  command(c) {
    const { s, tab, ps } = shown();
    const i = ps.findIndex((p) => p.focused);
    switch (c) {
      case "spawn":
        return spawn();
      // layout.toggle would hide the block, and hidden copies get no commands.
      case "togglebar":
        return run("layout.resize", { id: "bar", px: this.h > 0 ? 0 : BH });
      case "focusnext":
      case "focusprev": {
        if (ps.length < 2) return;
        const p = ps[(i + (c === "focusnext" ? 1 : -1) + ps.length) % ps.length];
        run("pane.focus", { pane: p.pane });
        if (tab.zoomed) run("pane.zoom", { pane: p.pane });
        return;
      }
      case "zoom":
        if (ps.length > 1 && !tab.zoomed) run("pane.swap", { direction: i === 0 ? "right" : "left" });
        return;
      case "lastview": {
        const prev = this.views[s?.id]?.prev;
        if (s?.tabs.some((x) => x.id === prev)) run("tab.select", { id: prev });
        return;
      }
      case "tile":
        if (tab?.zoomed) run("pane.zoom", { pane: ps.find((p) => p.zoomed)?.pane });
        return;
      case "monocle":
        if (tab && !tab.zoomed) run("pane.zoom");
        return;
    }
  }

  render() {
    const t = theme();
    const { norm, sel } = schemes(t);
    const { s, tab, ps } = shown();
    const focused = ps.find((p) => p.focused);
    if (s && tab) {
      const v = (this.views[s.id] ??= {});
      if (v.cur !== tab.id) [v.prev, v.cur] = [v.cur, tab.id];
    }

    const cell = (id, sc, text) =>
      div().id(id).flex_none().h_full().px(PAD).flex().items_center().bg(sc.bg).text_color(sc.fg).child(text);

    const tags = (s?.tabs ?? []).map((x) => {
      const sc = x.active ? sel : norm;
      const urg = x.status === "blocked" || x.status === "done";
      const fg = urg ? sc.bg : sc.fg;
      const box = div().absolute().left(1).top(1).size(4);
      return cell(`tag-${x.id}`, urg ? { fg, bg: sc.fg } : sc, x.name)
        .relative()
        .child(x.active && focused ? box.bg(fg) : box.border_1().border_color(fg))
        .on_mouse_down("left", stop)
        .on_click(() => run("tab.select", { id: x.id }));
    });

    const lt = cell("lt", norm, tab?.zoomed ? `[${tab.panes}]` : "[]=")
      .on_mouse_down("left", stop)
      .on_click(() => run("pane.zoom"));

    const sc = focused ? sel : norm;
    const title = div().flex_1().min_w(0).h_full().px(PAD).flex().items_center().bg(sc.bg).text_color(sc.fg)
      .child(div().truncate().child(focused?.title ?? ""));

    const clock = `${this.now.toDateString()} ${String(this.now.getHours()).padStart(2, "0")}:${String(this.now.getMinutes()).padStart(2, "0")}`;
    const status = div().flex_none().h_full().pr(2).flex().items_center().text_color(norm.fg)
      .child([s?.name, clock].filter(Boolean).join(" | "));

    const lp = lightsPad();

    return h_flex()
      .id("root")
      .on_size_change((size, cx) => {
        this.h = size.height;
        cx.notify();
      })
      .size_full()
      .overflow_hidden()
      .bg(norm.bg)
      .text_size(FONT)
      .when(lp > 0, (el) => el.child(div().id("lights").flex_none().w(lp).h_full()))
      .children(tags)
      .child(lt)
      .child(title)
      .child(status);
  }
}
