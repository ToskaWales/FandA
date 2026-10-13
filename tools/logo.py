"""Erzeugt das F&A-Logo (Seal + Mark) als SVG mit Buchstaben als Pfade (schriftunabhängig).
Aufruf: python3 tools/logo.py   (benötigt: fonttools, brotli)"""
import math, os, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONTS = os.path.join(ROOT, 'assets', 'fonts')
GOLD, GOLD_HI, GOLD_LO, IVORY, NAVY = '#d6aa5f', '#e8c67f', '#ac8449', '#faf8f9', '#06101a'

def load(name, axes):
    f = TTFont(os.path.join(FONTS, name))
    return instancer.instantiateVariableFont(f, axes, inplace=False)

bodoni = load('newsreader.woff2', {'wght': 560, 'opsz': 60})
bodoni_i = bodoni  # kein Kursiv: aufrechtes Et-Zeichen
sans = load('hanken-grotesk.woff2', {'wght': 700})

def text_path(font, text, size, x, y, anchor='middle', tracking=0, fill=IVORY):
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
    sc = size / upm
    adv = [gs[cmap[ord(c)]].width * sc + tracking for c in text]
    total = sum(adv) - tracking
    cx = x - total / 2 if anchor == 'middle' else x
    d = []
    for c, a in zip(text, adv):
        pen = SVGPathPen(gs)
        gs[cmap[ord(c)]].draw(TransformPen(pen, (sc, 0, 0, -sc, cx, y)))
        d.append(pen.getCommands()); cx += a
    return f'<path fill="{fill}" d="{" ".join(d)}"/>', total

def rosette(n, a, b, copies, pts=280, rot0=0.0):
    out = []
    for c in range(copies):
        th = rot0 + 2 * math.pi / copies * c
        pl = []
        for i in range(pts + 1):
            t = 2 * math.pi * i / pts
            x = a * math.cos(t) + b * math.cos(n * t); y = a * math.sin(t) - b * math.sin(n * t)
            pl.append(f'{x*math.cos(th)-y*math.sin(th):.1f},{x*math.sin(th)+y*math.cos(th):.1f}')
        out.append('<polyline points="' + ' '.join(pl) + '"/>')
    return ''.join(out)

def defs():
    return (f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{GOLD_HI}"/>'
            f'<stop offset=".5" stop-color="{GOLD}"/><stop offset="1" stop-color="{GOLD_LO}"/></linearGradient></defs>')

# ---------- Seal ----------
def seal():
    # Monogramm: F & A, mittig, Grundlinie y=30
    gF, wF = text_path(bodoni, 'F', 118, 0, 0, 'start')
    gA, wA = text_path(bodoni, 'A', 118, 0, 0, 'start')
    gAmp, wAmp = text_path(bodoni_i, '&', 96, 0, 0, 'start')
    gap = 5
    total = wF + wAmp + wA + 2 * gap
    x0 = -total / 2; base = 22
    parts = []
    x = x0
    for font, ch, size, fill, w in ((bodoni, 'F', 118, IVORY, wF), (bodoni_i, '&', 96, 'url(#g)', wAmp), (bodoni, 'A', 118, IVORY, wA)):
        parts.append(text_path(font, ch, size, x, base, 'start', fill=fill)[0]); x += w + gap
    sub, _ = text_path(sans, 'SALES CONSULTING', 13.5, 0, 74, 'middle', tracking=4.4, fill=IVORY)
    ring = (f'<g stroke="url(#g)" stroke-width="1.1" fill="none" opacity=".95">'
            f'<circle r="244"/><circle r="238" opacity=".5"/>'
            + rosette(24, 188, 24, 12, rot0=0.05) + rosette(12, 188, 14, 8, pts=220)
            + '<circle r="150"/><circle r="146" opacity=".5"/></g>')
    rule = f'<g stroke="url(#g)" stroke-width="1"><path d="M-84 46H84" opacity=".7"/><path d="M-84 92H84" opacity=".7"/></g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-250 -250 500 500" role="img" aria-label="F&amp;A Sales Consulting">'
            f'{defs()}<circle r="250" fill="{NAVY}"/>{ring}{"".join(parts)}{rule}{sub}</svg>')

# ---------- Mark (Favicon/App): goldenes & im Ring ----------
def mark():
    g, w = text_path(bodoni_i, '&', 330, 0, 0, 'start')
    amp, _ = text_path(bodoni_i, '&', 330, -w / 2, 118, 'start', fill='url(#g)')
    ring = ('<g stroke="url(#g)" fill="none" stroke-width="5"><circle r="236"/><circle r="214" opacity=".45" stroke-width="3"/></g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-250 -250 500 500" role="img" aria-label="F&amp;A">'
            f'{defs()}<circle r="250" fill="{NAVY}"/>{ring}{amp}</svg>')

if __name__ == '__main__':
    open(os.path.join(ROOT, 'assets', 'logo.svg'), 'w').write(seal())
    open(os.path.join(ROOT, 'assets', 'logo-mark.svg'), 'w').write(mark())
    for n in ('logo.svg', 'logo-mark.svg'):
        print(n, os.path.getsize(os.path.join(ROOT, 'assets', n)) // 1024, 'KB')
