// What the see-through panels sit on, and text colours that stay readable on it.
// The bar works this out because it always runs. It samples the layout's background
// (a gradient's stops, or a picture shrunk to 6 x 6), blends each sample under the
// panels' fill at the glass alpha, then lifts each of the theme's text colours toward
// white or black until it clears a contrast ratio against the worst blend. Every dwm
// mod lays the result, shared("glass.ink"), over theme().

import { exec, appHome } from "herdr";

// WCAG contrast ratios: body text, secondary text, hints; icons and status marks.
const TARGET = { foreground: 7, muted: 4.5, dim: 3 };
const MARKS = 3;
const MARKED = ["working", "blocked", "done", "idle", "unknown", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)];
const HEX = /^#[0-9a-f]{6}$/i;

// Prints "bmp" and the bytes of a 6 x 6 copy (sips, macOS), or "txt" and ImageMagick's
// pixel list; nothing when neither can read the picture.
const SAMPLE = [
  'f="$1"; tmp="${TMPDIR:-/tmp}/herdr-backdrop-$$.bmp"',
  'if command -v sips >/dev/null 2>&1 && sips -s format bmp -z 6 6 "$f" --out "$tmp" >/dev/null 2>&1; then',
  '  echo bmp; od -An -v -tu1 "$tmp"; rm -f "$tmp"',
  "elif command -v magick >/dev/null 2>&1; then echo txt; magick \"$f\" -resize '6x6!' -depth 8 txt:-",
  "elif command -v convert >/dev/null 2>&1; then echo txt; convert \"$f\" -resize '6x6!' -depth 8 txt:-",
  'fi; exit 0',
].join("\n");

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (v) => "#" + v.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");
export const mix = (a, b, k) => {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * k));
};

function luminance(c) {
  return rgb(c).reduce((sum, v, i) => {
    const s = v / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
}

const ratio = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// The least of `c` moved toward white or black that reaches `min` against every back.
function readable(c, backs, min) {
  const worst = (x) => Math.min(...backs.map((b) => ratio(x, b)));
  if (worst(c) >= min) return c;
  const to = worst("#ffffff") >= worst("#000000") ? "#ffffff" : "#000000";
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const m = (lo + hi) / 2;
    if (worst(mix(c, to, m)) >= min) hi = m;
    else lo = m;
  }
  return mix(c, to, hi);
}

// The theme's text colours, changed only where they'd be hard to read over the samples
// behind panels of the theme's background at alpha `a`.
export function inks(t, samples, a) {
  if (!samples.length || a >= 1 || !HEX.test(t.background ?? "")) return {};
  const backs = samples.map((s) => mix(s, t.background, a));
  const out = {};
  for (const [k, min] of Object.entries(TARGET)) if (HEX.test(t[k] ?? "")) out[k] = readable(t[k], backs, min);
  for (const k of MARKED) if (HEX.test(t[k] ?? "")) out[k] = readable(t[k], backs, MARKS);
  return out;
}

// A few colours that stand for the layout's background, or none for the theme's own.
export async function samples(bg) {
  if (bg?.gradient) {
    const [a, b] = bg.gradient;
    return HEX.test(a) && HEX.test(b) ? [0, 0.25, 0.5, 0.75, 1].map((k) => mix(a, b, k)) : [];
  }
  if (bg?.image) {
    const path = String(bg.image).startsWith("/") ? bg.image : `${appHome()}/${bg.image}`;
    const r = await exec("sh", ["-c", SAMPLE, "backdrop", path]).catch(() => null);
    return parse(r?.stdout ?? "");
  }
  return typeof bg === "string" && HEX.test(bg) ? [bg] : [];
}

function parse(out) {
  const nl = out.indexOf("\n"), kind = out.slice(0, nl), rest = out.slice(nl + 1);
  if (kind === "txt") return [...rest.matchAll(/#([0-9a-f]{6})/gi)].map((m) => `#${m[1].toLowerCase()}`);
  if (kind !== "bmp") return [];
  const b = rest.trim().split(/\s+/).map(Number);
  const u32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  if (b.length < 54 || b[0] !== 66 || b[1] !== 77) return [];
  const off = u32(10), w = u32(18), h = Math.abs(u32(22) | 0), bpp = b[28] | (b[29] << 8), px = bpp / 8;
  if (px !== 3 && px !== 4) return [];
  const stride = Math.ceil((w * px) / 4) * 4;
  // BI_BITFIELDS says where red, green and blue are; plain BMPs are BGR(A).
  const masks = u32(30) === 3 ? [u32(54), u32(58), u32(62)] : [0xff0000, 0xff00, 0xff];
  const chan = (v, m) => {
    if (!m) return 0;
    let s = 0;
    while (!((m >>> s) & 1)) s++;
    return (((v & m) >>> s) * 255) / (m >>> s);
  };
  const colors = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = off + y * stride + x * px;
      if (o + px > b.length) return colors;
      const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      colors.push(hex(masks.map((m) => chan(v, m))));
    }
  }
  return colors;
}
