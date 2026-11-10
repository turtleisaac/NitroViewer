#!/usr/bin/env python3
"""
Build web/electron/icon-mac.png. Needs Pillow and CairoSVG.
"""
import io
import math
from pathlib import Path

import cairosvg
from PIL import Image
from PIL import ImageChops
from PIL import ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'web' / 'electron' / 'icon.png'
DEST = ROOT / 'web' / 'electron' / 'icon-mac.png'

CANVAS = 1024
TILE = 824
MARGIN = 100
RADIUS = 185.4
SMOOTHING = 0.7
MASK_SCALE = 4

# Full-bleed icon background, sampled from electron/icon.png.
TILE_COLOR = (13, 14, 18, 255)

# Apple's template shadow on the 1024 grid.
SHADOW_ALPHA = 0.26
SHADOW_BLUR = 16
SHADOW_DY = 6


def num(value):
    """
    Format one SVG coordinate
    """
    return '%.4f' % value


def corner_params(radius, smoothing):
    """
    Continuous-corner handles for one 90 degree turn
    """
    arc_measure = 90.0 * (1.0 - smoothing)
    arc = math.sin(math.radians(arc_measure / 2.0)) * radius * math.sqrt(2.0)
    angle_alpha = (90.0 - arc_measure) / 2.0
    angle_beta = 45.0 * smoothing

    handle = radius * math.tan(math.radians(angle_alpha / 2.0))
    c = handle * math.cos(math.radians(angle_beta))
    d = c * math.tan(math.radians(angle_beta))

    p = (1.0 + smoothing) * radius
    b = (p - arc - c - d) / 3.0
    a = 2.0 * b
    return a, b, c, d, p, arc


def squircle_path(side, radius, smoothing):
    """
    SVG path for a continuous-corner rounded square
    """
    a, b, c, d, p, arc = corner_params(radius, smoothing)
    if (p * 2) >= side:
        raise ValueError('corner does not fit the tile')

    radius_text = num(radius)
    return ' '.join([
        'M %s 0' % num(side - p),
        'c %s 0 %s 0 %s %s' % (num(a), num(a + b), num(a + b + c), num(d)),
        'a %s %s 0 0 1 %s %s' % (radius_text, radius_text, num(arc), num(arc)),
        'c %s %s %s %s %s %s' % (num(d), num(c), num(d), num(b + c), num(d), num(a + b + c)),
        'L %s %s' % (num(side), num(side - p)),
        'c 0 %s 0 %s %s %s' % (num(a), num(a + b), num(-d), num(a + b + c)),
        'a %s %s 0 0 1 %s %s' % (radius_text, radius_text, num(-arc), num(arc)),
        'c %s %s %s %s %s %s' % (num(-c), num(d), num(-(b + c)), num(d), num(-(a + b + c)), num(d)),
        'L %s %s' % (num(p), num(side)),
        'c %s 0 %s 0 %s %s' % (num(-a), num(-(a + b)), num(-(a + b + c)), num(-d)),
        'a %s %s 0 0 1 %s %s' % (radius_text, radius_text, num(-arc), num(-arc)),
        'c %s %s %s %s %s %s' % (num(-d), num(-c), num(-d), num(-(b + c)), num(-d), num(-(a + b + c))),
        'L 0 %s' % num(p),
        'c 0 %s 0 %s %s %s' % (num(-a), num(-(a + b)), num(d), num(-(a + b + c))),
        'a %s %s 0 0 1 %s %s' % (radius_text, radius_text, num(arc), num(-arc)),
        'c %s %s %s %s %s %s' % (num(c), num(-d), num(b + c), num(-d), num(a + b + c), num(-d)),
        'Z',
    ])


def render_mask():
    """
    Rasterize the 824px tile on the 1024 canvas
    """
    path = squircle_path(TILE, RADIUS, SMOOTHING)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
        '<path d="%s" fill="#ffffff" transform="translate(%d %d)"/></svg>'
    ) % (CANVAS, CANVAS, CANVAS, CANVAS, path, MARGIN, MARGIN)

    png = cairosvg.svg2png(
        bytestring=svg.encode('utf-8'),
        output_width=CANVAS * MASK_SCALE,
        output_height=CANVAS * MASK_SCALE,
    )

    rendered = Image.open(io.BytesIO(png)).convert('L')
    return rendered.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)


def build_plate(mask):
    """
    Scale the full-bleed artwork into the tile and clip it to the mask
    """
    artwork = Image.open(SOURCE).convert('RGBA')
    artwork = artwork.resize((TILE, TILE), Image.Resampling.LANCZOS)

    plate = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    tile = Image.new('RGBA', (TILE, TILE), TILE_COLOR)
    plate.paste(tile, (MARGIN, MARGIN))
    plate.paste(artwork, (MARGIN, MARGIN), artwork)

    red, green, blue, alpha = plate.split()
    alpha = ImageChops.multiply(alpha, mask)
    return Image.merge('RGBA', (red, green, blue, alpha))


def build_shadow(mask):
    """
    Soft drop shadow from the tile mask
    """
    blurred = mask.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    faded = blurred.point(lambda value: int(round(value * SHADOW_ALPHA)))

    shifted = Image.new('L', (CANVAS, CANVAS), 0)
    shifted.paste(faded, (0, SHADOW_DY))

    shadow = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.putalpha(shifted)
    return shadow


def check_tile(mask):
    """
    Fail if the opaque tile is not the centered 824px box
    """
    solid = mask.point(lambda value: 255 if value >= 128 else 0)
    bbox = solid.getbbox()
    if bbox != (MARGIN, MARGIN, MARGIN + TILE, MARGIN + TILE):
        raise ValueError('tile bbox %s is not the 824px grid' % (bbox,))


def main():
    """
    Write the macOS icon next to the full-bleed source
    """
    mask = render_mask()
    check_tile(mask)
    plate = build_plate(mask)
    shadow = build_shadow(mask)
    icon = Image.alpha_composite(shadow, plate)

    icon.save(DEST)
    print(DEST)


if __name__ == '__main__':
    main()
