#!/usr/bin/env python3
# Draws the deck's pixel art as SVGs beside this file: run it after changing a bitmap.
# One SVG unit is one art pixel; the mod shows them at 2 screen pixels each, with
# crisp edges. Monochrome glyphs (suits, ranks) are tinted by the mod with svg().

import os

HERE = os.path.dirname(os.path.abspath(__file__))
RED, INK, BLUE, WHITE = "#e3241b", "#111111", "#1f3fae", "#ffffff"

SUIT5 = [  # hearts, diamonds, spades, clubs: the index beside the rank
    [".#.#.", "#####", "#####", ".###.", "..#.."],
    ["..#..", ".###.", "#####", ".###.", "..#.."],
    ["..#..", ".###.", "#####", "#.#.#", "..#.."],
    [".###.", ".###.", "#####", "#.#.#", "..#.."],
]
SUIT7 = [  # the pips of 2 to 10
    [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
    ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."],
    ["...#...", "..###..", ".#####.", "#######", "#######", ".#.#.#.", "..###.."],
    ["..###..", "..###..", "##.#.##", "#######", "##.#.##", "...#...", "..###.."],
]
SUIT9 = [  # aces and court cards
    [".##...##.", "####.####", "#########", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."],
    ["....#....", "...###...", "..#####..", ".#######.", "#########", ".#######.", "..#####..", "...###...", "....#...."],
    ["....#....", "...###...", "..#####..", ".#######.", "#########", "#########", ".##.#.##.", "....#....", "...###..."],
    ["...###...", "..#####..", "..#####..", "...###...", ".##.#.##.", "#########", ".##.#.##.", "....#....", "...###..."],
]
RANKS = {
    1: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    6: [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    9: [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    10: [".#..###.", "##.#...#", ".#.#..##", ".#.#.#.#", ".#.##..#", ".#.#...#", "###.###."],
    11: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    12: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    13: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
}
# Court figures, the top half of each, as the left 7 columns: the right half mirrors them,
# and the card shows the half again upside down below, as printed cards do. k ink, y gold,
# s skin, h hair, w white, b blue, r red, R the robe (red for hearts and diamonds, blue else).
COURT = {
    13: [  # the King: crown, beard, robe with a gold chain
        "...y..y", "...yyyy", "...yryy", "..khhhh", "..khsss", "..khsks", "..khsss", "..khssr",
        "..kwwss", "..kwwww", ".kRkwww", "kRRRkww", "kRyRRkw", "kRRRRRk", "kRyRRRR", "yyyyyyy",
    ],
    12: [  # the Queen: tiara, long hair, lace collar, necklace
        "....y.y", "....yyy", "...khby", "..khhhh", "..hhsss", "..hhsks", "..hhsss", "..hhssr",
        "..hhhss", ".hhwwkw", ".hRwwww", "kRRRwyw", "kRyRRww", "kRRRRRR", "kRyRRRR", "yyyyyyy",
    ],
    11: [  # the Jack: a cap with a gold band, no beard, a high collar
        ".......", "...kkkk", "..kbbbb", ".kbbyby", "..khhhh", "..khsss", "..khsks", "..khsss",
        "...kssr", "....kss", ".kRRkww", "kRRRRkw", "kRyRRRk", "kRRRRRR", "kRyRRRR", "yyyyyyy",
    ],
}
COURT_COLORS = {"k": INK, "y": "#f2c21b", "s": "#f6c99a", "h": "#7a3e12", "w": WHITE, "b": BLUE, "r": RED}


def svg(w, h, body, crisp=True):
    edges = ' shape-rendering="crispEdges"' if crisp else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"{edges}>{body}</svg>\n'


def runs(rows, colors=None, dx=0, dy=0):
    # One rect per run of same-coloured pixels in a row.
    out = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == ".":
                x += 1
                continue
            end = x
            while end < len(row) and row[end] == ch:
                end += 1
            fill = (colors or {}).get(ch, "#000000")
            out.append(f'<rect x="{x + dx}" y="{y + dy}" width="{end - x}" height="1" fill="{fill}"/>')
            x = end
    return "".join(out)


def flip(rows):
    return [row[::-1] for row in rows[::-1]]


def write(name, text):
    with open(os.path.join(HERE, name), "w") as f:
        f.write(text)


def glyph(name, rows):
    write(f"{name}.svg", svg(max(map(len, rows)), len(rows), runs(rows)))
    write(f"{name}f.svg", svg(max(map(len, rows)), len(rows), runs(flip(rows))))


for i in range(4):
    glyph(f"s{i}-5", SUIT5[i])
    glyph(f"s{i}-7", SUIT7[i])
    glyph(f"s{i}-9", SUIT9[i])
for r, rows in RANKS.items():
    glyph(f"r{r}", rows)
# An empty stock: click it to turn the waste over.
glyph("ring", ["..#####..", ".##...##.", "##.....##", "#.......#", "#.......#", "#.......#", "##.....##", ".##...##.", "..#####.."])
for r, left in COURT.items():
    top = [row + row[::-1] for row in left]
    assert all(len(row) == 14 for row in top), r
    for name, robe in (("r", RED), ("b", BLUE)):
        colors = {**COURT_COLORS, "R": robe}
        # An 18 x 36 panel: ink frame, a rule in the robe colour, the figure twice inside.
        body = (f'<rect width="18" height="36" fill="{INK}"/><rect x="1" y="1" width="16" height="34" fill="{robe}"/>'
                f'<rect x="2" y="2" width="14" height="32" fill="#fbe9a6"/>' + runs(top, colors, 2, 2) + runs(flip(top), colors, 2, 18))
        write(f"court{r}-{name}.svg", svg(18, 36, body))

# The card itself, 36 x 50, with notched corners and a soft grey rim.
EDGE = "M2 0H34V1H35V2H36V48H35V49H34V50H2V49H1V48H0V2H1V1H2Z"
FACE = "M2 1H34V2H35V48H34V49H2V48H1V2H2Z"
write("card.svg", svg(36, 50, f'<path d="{EDGE}" fill="#cfcfcf"/><path d="{FACE}" fill="{WHITE}"/>'))

# The back: a white margin round a blue field of red-cored diamonds.
TILE = ["bbbwbbbb", "bbwrwbbb", "bwrrrwbb", "wrrrrrwb", "bwrrrwbb", "bbwrwbbb", "bbbwbbbb", "bbbbbbbb"]
field = "".join(runs(TILE, {"b": BLUE, "w": WHITE, "r": RED}, x, y) for y in range(3, 47, 8) for x in range(3, 33, 8))
back = (f'<path d="{EDGE}" fill="#cfcfcf"/><path d="{FACE}" fill="{WHITE}"/>'
        f'<svg x="3" y="3" width="30" height="44" viewBox="3 3 30 44">{field}</svg>'
        f'<rect x="2.5" y="2.5" width="31" height="45" fill="none" stroke="#0d1f5c" stroke-width="1"/>')
write("back.svg", svg(36, 50, back))

# The felt: bright green with a fine grain.
write("felt.svg", svg(588, 500,
      '<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7"/>'
      '<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 0.55"/></filter>'
      '<rect width="588" height="500" fill="#16912a"/><rect width="588" height="500" fill="#000000" filter="url(#grain)"/>', crisp=False))
print("wrote", len([n for n in os.listdir(HERE) if n.endswith(".svg")]), "svgs")
