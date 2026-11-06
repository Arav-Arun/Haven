#!/usr/bin/env python3
"""Haven's icons: its mark (a shield holding a database over linked blocks) in white on the blue clay tile.

The mark is kept once, as apps/web/public/haven-mark.webp: white on transparent, square, 512 px. Every icon is the
same tile the site draws in components/landing/Logo.tsx: a rounded square, #5b93ff at the top to #1f4fd1 at the
bottom, a soft shine over its upper half, and the mark in white. Maskable and iOS icons fill the whole square (the
platform rounds it); the rest keep the tile's own rounded corners on transparent. Outputs are committed.

  python3 apps/web/scripts/make-icons.py                      # redraw the icons from haven-mark.webp
  python3 apps/web/scripts/make-icons.py --from <black-on-white.png>   # replace the mark first, then redraw
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web/public"
MARK = WEB / "haven-mark.webp"


def mark_from(src: Path) -> Image.Image:
    """A black-on-white drawing → a white mark on transparent, cropped and centred in a 512 px square."""
    grey = Image.open(src).convert("L")
    # Ink becomes opacity; the paper's near-white noise drops out, anti-aliased edges stay smooth.
    alpha = grey.point(lambda v: max(0, min(255, round((235 - v) * 255 / 215))))
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    alpha = alpha.crop(box)
    side = max(alpha.size)
    square = Image.new("L", (side, side), 0)
    square.paste(alpha, ((side - alpha.width) // 2, (side - alpha.height) // 2))
    square = square.resize((512, 512), Image.LANCZOS)
    out = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
    out.putalpha(square)
    return out


TOP = (0x5B, 0x93, 0xFF)
BOTTOM = (0x1F, 0x4F, 0xD1)


def icon(size: int, mark_share: float, full_bleed: bool) -> Image.Image:
    """The blue tile with its shine and the white mark, centred. Drawn at 4x, then scaled down for smooth edges."""
    s = size * 4
    ramp = Image.new("RGBA", (1, s))
    for y in range(s):
        t = y / (s - 1)
        ramp.putpixel((0, y), (*(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)), 255))
    tile = ramp.resize((s, s))
    # The shine: white at 45% at the top, gone by the middle, as on the site's tile.
    shine = Image.new("L", (1, s))
    for y in range(s):
        shine.putpixel((0, y), round(115 * max(0.0, 1 - y / (s / 2))))
    tile.paste(Image.new("RGBA", (s, s), (255, 255, 255, 255)), (0, 0), shine.resize((s, s)))
    mark = Image.open(MARK).convert("RGBA")
    m = round(s * mark_share)
    tile.paste(Image.new("RGBA", (m, m), (255, 255, 255, 255)), ((s - m) // 2, (s - m) // 2), mark.getchannel("A").resize((m, m), Image.LANCZOS))
    if not full_bleed:
        corners = Image.new("L", (s, s), 0)
        ImageDraw.Draw(corners).rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.28), fill=255)
        tile.putalpha(corners)
    return tile.resize((size, size), Image.LANCZOS)


def main() -> None:
    if "--from" in sys.argv:
        mark_from(Path(sys.argv[sys.argv.index("--from") + 1])).save(MARK, "WEBP", lossless=True, method=6)
    icon(512, 0.64, False).save(WEB / "icon-512.png", optimize=True)
    icon(192, 0.64, False).save(WEB / "icon-192.png", optimize=True)
    icon(512, 0.5, True).save(WEB / "icon-maskable-512.png", optimize=True)  # inside the maskable safe zone
    icon(180, 0.6, True).save(WEB / "apple-touch-icon.png", optimize=True)
    icon(64, 0.66, False).save(WEB / "favicon.png", optimize=True)

if __name__ == "__main__":
    main()
