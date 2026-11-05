// dwm: the bar (layout block, props { role: "bar" }) and dmenu (this mod's
// overlay, opened with mod.open:dwm).

import { View } from "gpui-kit";
import { props } from "herdr";
import Bar from "./bar.js";
import Dmenu from "./dmenu.js";

export default class Dwm extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.role = pr.role === "bar" ? new Bar() : new Dmenu();
    this.role.init(pr, cx);
  }

  render(cx) {
    return this.role.render(cx);
  }
}
