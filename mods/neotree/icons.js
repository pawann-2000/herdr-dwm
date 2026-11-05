// Nerd Font glyphs and colors, after neo-tree's defaults and nvim-web-devicons.
// Herdr ships Symbols Nerd Font, so the glyphs draw whatever the ui_font is.

export const ICON_FONT = "Symbols Nerd Font";

export const GLYPH = {
  folder: "",
  folderOpen: "",
  folderEmpty: "\u{F0256}",
  file: "",
  branch: "",
};

// neo-tree's git_status symbols and highlight colors.
export const GIT = {
  U: { glyph: "", color: "#ff8700" },
  M: { glyph: "", color: "#d7af5f" },
  D: { glyph: "", color: "#ff5900" },
  "?": { glyph: "", color: "#ff8700" },
  A: { glyph: "", color: "#5faf5f" },
  S: { glyph: "", color: "#5faf5f" },
};

export const DIR_COLOR = "#61afef";
const DEFAULT = { glyph: GLYPH.file, color: "#6d8086" };

const BY_NAME = {
  "dockerfile": ["\u{F0868}", "#458ee6"],
  "docker-compose.yml": ["\u{F0868}", "#458ee6"],
  "docker-compose.yaml": ["\u{F0868}", "#458ee6"],
  ".dockerignore": ["\u{F0868}", "#458ee6"],
  "makefile": ["", "#6d8086"],
  "cmakelists.txt": ["", "#6d8086"],
  ".gitignore": ["", "#f54d27"],
  ".gitattributes": ["", "#f54d27"],
  ".gitmodules": ["", "#f54d27"],
  ".gitconfig": ["", "#f54d27"],
  "license": ["", "#d0bf41"],
  "license.md": ["", "#d0bf41"],
  "copying": ["", "#d0bf41"],
  "package.json": ["", "#e8274b"],
  "package-lock.json": ["", "#7a0d21"],
  "cargo.toml": ["", "#dea584"],
  "cargo.lock": ["", "#dea584"],
  "go.mod": ["", "#519aba"],
  "go.sum": ["", "#519aba"],
  "flake.nix": ["", "#7ebae4"],
  "flake.lock": ["", "#7ebae4"],
};

const BY_EXT = {
  js: ["", "#cbcb41"], mjs: ["", "#f1e05a"], cjs: ["", "#cbcb41"],
  ts: ["", "#519aba"], mts: ["", "#519aba"], cts: ["", "#519aba"],
  jsx: ["", "#20c2e3"], tsx: ["", "#1354bf"],
  json: ["", "#cbcb41"], jsonc: ["", "#cbcb41"],
  md: ["", "#dddddd"], mdx: ["", "#519aba"],
  rs: ["", "#dea584"], go: ["", "#00add8"], py: ["", "#ffbc03"],
  lua: ["", "#51a0cf"], vim: ["", "#019833"],
  sh: ["", "#4d5a5e"], bash: ["", "#89e051"], zsh: ["", "#89e051"], fish: ["", "#4d5a5e"],
  toml: ["", "#9c4221"], yaml: ["", "#6d8086"], yml: ["", "#6d8086"],
  ini: ["", "#6d8086"], conf: ["", "#6d8086"], cfg: ["", "#6d8086"],
  html: ["", "#e44d26"], css: ["", "#42a5f5"], scss: ["", "#f55385"], sass: ["", "#f55385"],
  svg: ["\u{F0721}", "#ffb13b"], xml: ["\u{F05C0}", "#e37933"],
  png: ["", "#a074c4"], jpg: ["", "#a074c4"], jpeg: ["", "#a074c4"], gif: ["", "#a074c4"],
  webp: ["", "#a074c4"], bmp: ["", "#a074c4"], ico: ["", "#cbcb41"],
  mp4: ["", "#fd971f"], mov: ["", "#fd971f"], mkv: ["", "#fd971f"], webm: ["", "#fd971f"],
  mp3: ["", "#00afff"], wav: ["", "#00afff"], flac: ["", "#0075aa"], ogg: ["", "#0075aa"],
  lock: ["", "#bbbbbb"], lockb: ["", "#bbbbbb"],
  c: ["", "#599eff"], h: ["", "#a074c4"], cpp: ["", "#519aba"], cc: ["", "#f34b7d"], hpp: ["", "#a074c4"],
  java: ["", "#cc3e44"], kt: ["", "#7f52ff"], swift: ["", "#e37933"], rb: ["", "#701516"],
  php: ["", "#a074c4"], dart: ["", "#03589c"], ex: ["", "#a074c4"], exs: ["", "#a074c4"],
  hs: ["", "#a074c4"], zig: ["", "#f69a1b"], nix: ["", "#7ebae4"],
  sql: ["", "#dad8d8"], csv: ["", "#89e051"], txt: ["\u{F0219}", "#89e051"], pdf: ["", "#b30b00"],
  zip: ["", "#eca517"], tar: ["", "#eca517"], gz: ["", "#eca517"], tgz: ["", "#eca517"],
  xz: ["", "#eca517"], "7z": ["", "#eca517"], rar: ["", "#eca517"],
  ttf: ["", "#ececec"], otf: ["", "#ececec"], woff: ["", "#ececec"], woff2: ["", "#ececec"],
  graphql: ["", "#e535ab"], gql: ["", "#e535ab"], wasm: ["", "#5c4cdb"],
};

export function fileIcon(name) {
  const lower = name.toLowerCase();
  if (lower.startsWith(".env")) return { glyph: "", color: "#faf743" };
  const hit = BY_NAME[lower] ?? BY_EXT[lower.includes(".") ? lower.split(".").pop() : ""];
  return hit ? { glyph: hit[0], color: hit[1] } : DEFAULT;
}
