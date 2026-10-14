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

# ---------- Seal (nach Vorlage: F | & | A, offener Ring, Balken mit Pfeil) ----------
def taper_arc(cx, cy, r, a0, a1, wmax, n=160, power=.75):
    """Gefüllter Bogen, der zu beiden Enden hin auslaufend dünn wird. Winkel in Grad, im Uhrzeigersinn ab +x."""
    outer, inner = [], []
    for i in range(n + 1):
        u = i / n; a = math.radians(a0 + (a1 - a0) * u)
        hw = wmax / 2 * math.sin(math.pi * u) ** power
        outer.append((cx + (r + hw) * math.cos(a), cy + (r + hw) * math.sin(a)))
        inner.append((cx + (r - hw) * math.cos(a), cy + (r - hw) * math.sin(a)))
    pts = outer + inner[::-1]
    return '<path d="M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + 'Z" fill="url(#g)"/>'

def seal_defs():
    return (f'<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="260" x2="820" y2="620">'
            f'<stop offset="0" stop-color="{GOLD_HI}"/><stop offset=".55" stop-color="{GOLD}"/><stop offset="1" stop-color="{GOLD_LO}"/></linearGradient>'
            f'<linearGradient id="h" gradientUnits="userSpaceOnUse" x1="130" x2="872" y1="0" y2="0"><stop offset="0" stop-color="{GOLD}" stop-opacity="0"/><stop offset=".5" stop-color="{GOLD}"/><stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></linearGradient></defs>')

def seal():
    serif = load('newsreader.woff2', {'wght': 360, 'opsz': 72})
    light = load('hanken-grotesk.woff2', {'wght': 300})
    reg = load('hanken-grotesk.woff2', {'wght': 400})
    base = 562; cx = 502
    SZ, SE, gap = 300, 176, 26
    wF = text_path(serif, 'F', SZ, 0, 0, 'start')[1]; wA = text_path(serif, 'A', SZ, 0, 0, 'start')[1]
    wE = text_path(serif, '&', SE, 0, 0, 'start')[1]
    total = wF + wA + wE + 4 * gap + 2
    x = cx - total / 2
    f = text_path(serif, 'F', SZ, x, base, 'start', fill='url(#g)')[0]; x += wF + gap
    l1 = x; x += 1 + gap
    e = text_path(serif, '&', SE, x, base - 14, 'start', fill=IVORY)[0]; x += wE + gap
    l2 = x; x += 1 + gap
    a = text_path(serif, 'A', SZ, x, base, 'start', fill='url(#g)')[0]
    v = f'<g stroke="{GOLD}" stroke-width="1.4"><path d="M{l1:.1f} 440V{base-2}"/><path d="M{l2:.1f} 440V{base-2}"/></g>'
    sub = text_path(light, 'SALES CONSULTING', 41, cx, 667, 'middle', tracking=13.5, fill=IVORY)[0]
    rules = f'<g stroke="url(#h)" stroke-width="1.6"><path d="M130 603H872"/><path d="M130 698H872"/></g>'
    ring = taper_arc(cx + 2, 520, 362, 226, 374, 5.5) + taper_arc(cx + 2, 520, 362, 33, 147, 4.5)
    bars = (f'<g fill="url(#g)"><rect x="456" y="800" width="26" height="30"/><rect x="496" y="780" width="26" height="50"/>'
            f'<rect x="536" y="758" width="26" height="72"/></g>'
            f'<path d="M449 790C486 784 528 760 574 722" fill="none" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/>'
            f'<path d="M580 716L560 721L571 736Z" fill="url(#g)"/>')
    tag = text_path(reg, 'MEHR WERT. MEHR ERFOLG. GEMEINSAM WACHSEN.', 19.5, cx, 917, 'middle', tracking=3.2, fill=GOLD)[0]
    foot = f'<path d="M{cx-52} 948H{cx+52}" stroke="{GOLD}" stroke-width="1.2" opacity=".8"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="F&amp;A Sales Consulting">'
            f'{seal_defs()}<rect width="1000" height="1000" fill="{NAVY}"/>{ring}{f}{v}{e}{a}{rules}{sub}{bars}{tag}{foot}</svg>')

# ---------- Mark (Favicon/App): goldenes & im offenen Ring ----------
def mark():
    serif = load('newsreader.woff2', {'wght': 420, 'opsz': 72})
    g, w = text_path(serif, '&', 330, 0, 0, 'start')
    amp = text_path(serif, '&', 330, -w / 2, 112, 'start', fill='url(#g)')[0]
    ring = taper_arc(0, 0, 222, 218, 382, 9) + taper_arc(0, 0, 222, 28, 152, 7)
    d = (f'<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-200" y1="-200" x2="200" y2="200">'
         f'<stop offset="0" stop-color="{GOLD_HI}"/><stop offset=".55" stop-color="{GOLD}"/><stop offset="1" stop-color="{GOLD_LO}"/></linearGradient></defs>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-250 -250 500 500" role="img" aria-label="F&amp;A">'
            f'{d}<circle r="250" fill="{NAVY}"/>{ring}{amp}</svg>')

if __name__ == '__main__':
    open(os.path.join(ROOT, 'assets', 'logo.svg'), 'w').write(seal())
    open(os.path.join(ROOT, 'assets', 'logo-mark.svg'), 'w').write(mark())
    for n in ('logo.svg', 'logo-mark.svg'):
        print(n, os.path.getsize(os.path.join(ROOT, 'assets', n)) // 1024, 'KB')
