#!/usr/bin/env python3
"""
Build web assets from the brand kit in brand/ (docs/design.md §Brand).

- Makes a tiny self-hosted wordmark font: Archivo at width 125, weight 800, caps A–Z only.
- Outlines the PHASEPLAY ribbon text in the logo SVGs to paths with that exact font, so the logos
  look right everywhere (as <img>, in exports, with no font loaded).
- Copies favicons and app icons into apps/web/static/icons/.

    pip install fonttools brotli
    python3 scripts/brand/build.py
"""
import re
import shutil
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'brand'
WEB = ROOT / 'apps/web'
OUT_BRAND = WEB / 'static/brand'
OUT_ICONS = WEB / 'static/icons'
OUT_FONTS = WEB / 'static/fonts'
SRC_FONT = WEB / 'node_modules/@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2'

# 1. Wordmark font: static instance, caps only.
font = TTFont(SRC_FONT)
font = instantiateVariableFont(font, {'wght': 800, 'wdth': 125})
opts = Options()
opts.flavor = 'woff2'
opts.layout_features = ['kern']
opts.name_IDs = ['*']
sub = Subsetter(opts)
sub.populate(text='ABCDEFGHIJKLMNOPQRSTUVWXYZ ')
sub.subset(font)
OUT_FONTS.mkdir(parents=True, exist_ok=True)
font.flavor = 'woff2'
font.save(OUT_FONTS / 'archivo-expanded-800-caps.woff2')

# 2. Outline the ribbon text.
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font['head'].unitsPerEm
hmtx = font['hmtx']


def outline(text: str, x: float, y: float, size: float, spacing: float) -> str:
    k = size / upem
    names = [cmap[ord(ch)] for ch in text]
    advances = [hmtx[n][0] * k for n in names]
    width = sum(advances) + spacing * (len(text) - 1)
    pen_x = x - width / 2  # text-anchor: middle (no trailing letter-spacing)
    parts = []
    for n, adv in zip(names, advances):
        pen = SVGPathPen(glyphs)
        glyphs[n].draw(TransformPen(pen, (k, 0, 0, -k, pen_x, y)))
        d = re.sub(r'-?\d+\.\d+', lambda m: f'{float(m[0]):.2f}'.rstrip('0').rstrip('.'), pen.getCommands())
        if d:
            parts.append(d)
        pen_x += adv + spacing
    return ' '.join(parts)


TEXT_RE = re.compile(r'<text x="([\d.]+)" y="([\d.]+)" style="([^"]*)">([^<]*)</text>')


def outline_svg(svg: str) -> str:
    def repl(m: re.Match) -> str:
        x, y, style, text = float(m[1]), float(m[2]), m[3], m[4]
        size = float(re.search(r'font-size:\s*([\d.]+)px', style)[1])
        spacing = float(re.search(r'letter-spacing:\s*([\d.]+)px', style)[1])
        fill = re.search(r'fill:\s*(#[0-9A-Fa-f]{3,8})', style)[1]
        d = outline(text, x, y, size, spacing)
        return f'<path d="{d}" style="fill: {fill}"><title>{text}</title></path>'

    return TEXT_RE.sub(repl, svg)


OUT_BRAND.mkdir(parents=True, exist_ok=True)
for f in KIT.glob('*.svg'):
    svg = f.read_text()
    out = outline_svg(svg)
    if '<text' in out:
        raise SystemExit(f'{f.name}: text left un-outlined')
    (OUT_BRAND / f.name).write_text(out)

# 3. Icons.
OUT_ICONS.mkdir(parents=True, exist_ok=True)
png = KIT / 'png'
for src, dst in [
    ('apple-touch-icon-180.png', 'apple-touch-icon.png'),
    ('icon-192.png', 'icon-192.png'),
    ('icon-512.png', 'icon-512.png'),
    ('icon-maskable-512.png', 'maskable-512.png'),
    ('favicon-32.png', 'favicon-32.png'),
    ('favicon-16.png', 'favicon-16.png'),
]:
    shutil.copyfile(png / src, OUT_ICONS / dst)
shutil.copyfile(KIT / 'favicon.ico', WEB / 'static/favicon.ico')
shutil.copyfile(OUT_BRAND / 'phaseplay-mark.svg', OUT_ICONS / 'favicon.svg')
print('brand assets built')
