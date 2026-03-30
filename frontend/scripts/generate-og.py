#!/usr/bin/env python3
"""Generate logo-og.png for Nadeshiko OG image."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math
import urllib.request
import re
import numpy as np

FONTS_DIR = Path(__file__).parent / ".fonts-cache"
FONTS_DIR.mkdir(exist_ok=True)

GOOGLE_FONTS = {
    "Outfit-Medium-500.ttf": "https://fonts.googleapis.com/css2?family=Outfit:wght@500",
    "Outfit-Regular.ttf":    "https://fonts.googleapis.com/css2?family=Outfit:wght@400",
    "YujiSyuku-Regular.ttf": "https://fonts.googleapis.com/css2?family=Yuji+Syuku",
}

def ensure_font(filename):
    path = FONTS_DIR / filename
    if not path.exists():
        print(f"Downloading {filename}...")
        req = urllib.request.Request(GOOGLE_FONTS[filename], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            url = re.search(r"url\((https://[^)]+\.ttf)\)", r.read().decode()).group(1)
        urllib.request.urlretrieve(url, path)
    return path

W, H = 1200, 630
BG_COLOR = (239, 85, 82)  # #ef5552

img = Image.new("RGBA", (W, H), BG_COLOR + (255,))

# --- Background pattern: 習, handwriting font, very low opacity ---
kanji_font = ImageFont.truetype(ensure_font("YujiSyuku-Regular.ttf"), 220)

CHAR = "習"
pattern_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pdraw = ImageDraw.Draw(pattern_layer)

bbox = kanji_font.getbbox(CHAR)
char_w = bbox[2] - bbox[0]
char_h = bbox[3] - bbox[1]
col_gap = char_w + 60
row_gap = char_h + 50

for row in range(-1, math.ceil(H / row_gap) + 2):
    for col in range(-1, math.ceil(W / col_gap) + 2):
        x = col * col_gap + (col_gap // 2 if row % 2 else 0)
        y = row * row_gap
        pdraw.text((x, y), CHAR, font=kanji_font, fill=(255, 255, 255, 8))

img = Image.alpha_composite(img, pattern_layer)

# --- Logo ---
logo_src = Image.open(Path(__file__).parent.parent / "public/logo.webp").convert("RGBA")
logo_size = 380
logo = logo_src.resize((logo_size, logo_size), Image.LANCZOS)

# Circular clip: supersampled then Gaussian-blurred edge for smooth fade
SS2 = 4
clip_hi = Image.new("L", (logo_size * SS2, logo_size * SS2), 0)
ImageDraw.Draw(clip_hi).ellipse([0, 0, logo_size * SS2 - 1, logo_size * SS2 - 1], fill=255)
clip = clip_hi.resize((logo_size, logo_size), Image.LANCZOS)
clip = clip.filter(ImageFilter.GaussianBlur(radius=22))
logo.putalpha(clip)

# --- Fonts ---
font_title = ImageFont.truetype(ensure_font("Outfit-Medium-500.ttf"), 110)
font_sub   = ImageFont.truetype(ensure_font("Outfit-Regular.ttf"), 36)

title    = "Nadeshiko"
subtitle = "Search over 1 million Japanese sentences from anime & J-dramas"
tb = font_title.getbbox(title)
sb = font_sub.getbbox(subtitle)
title_h = tb[3] - tb[1]
sub_h   = sb[3] - sb[1]

# Layout: logo near top with breathing room, title high on canvas
logo_y  = 28
gap1    = -62  # logo -> title
gap2    = 68   # title -> subtitle
title_y = logo_y + logo_size + gap1
sub_y   = title_y + title_h + gap2

logo_x  = (W - logo_size) // 2
img.paste(logo, (logo_x, logo_y), logo)

draw = ImageDraw.Draw(img)

title_w = tb[2] - tb[0]
draw.text(((W - title_w) // 2, title_y), title, font=font_title, fill=(255, 255, 255, 255))

sub_w = sb[2] - sb[0]
draw.text(((W - sub_w) // 2, sub_y), subtitle, font=font_sub, fill=(255, 255, 255, 255))

# --- White rounded border (supersampled for smooth antialiased edges) ---
border = 14   # border thickness
radius = 48   # outer corner radius
SS = 4        # supersampling factor

# Draw mask at SS× resolution, then downscale → smooth edges
hi_w, hi_h = W * SS, H * SS
content_mask_hi = Image.new("L", (hi_w, hi_h), 0)
ImageDraw.Draw(content_mask_hi).rounded_rectangle(
    [border * SS, border * SS, hi_w - 1 - border * SS, hi_h - 1 - border * SS],
    radius=(radius - border) * SS,
    fill=255,
)
content_mask = content_mask_hi.resize((W, H), Image.LANCZOS)

img.putalpha(content_mask)

# Composite onto a white canvas — corners outside rounded rect become white
white = Image.new("RGBA", (W, H), (255, 255, 255, 255))
img = Image.alpha_composite(white, img)

out_path = Path(__file__).parent.parent / "public/logo-og.png"
img.convert("RGB").save(out_path, "PNG", optimize=True)
print(f"Saved: {out_path}  ({logo_size}px logo, title_y={title_y}, sub_y={sub_y})")
