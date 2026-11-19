// The see-through panels: a theme color with the alpha picked in the glass window
// (shared("glass").panels). The dwm mods paint their fills through glass(); text,
// borders and the selection stay solid. `floor` keeps a fill at least that opaque.

import { shared } from "herdr";

export const DEFAULTS = { panels: 0.85 };

export function panels() {
  const v = shared("glass")?.panels;
  return typeof v === "number" ? Math.min(1, Math.max(0, v)) : DEFAULTS.panels;
}

export function glass(color, floor = 0) {
  const a = Math.max(floor, panels());
  if (a >= 1 || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  return color + Math.round(a * 255).toString(16).padStart(2, "0");
}
