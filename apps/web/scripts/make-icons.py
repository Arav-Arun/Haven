#!/usr/bin/env python3
"""Haven's icons from its mark (a shield holding a database over linked blocks).

The mark is kept once, as apps/web/public/haven-mark.webp: white on transparent, square, 512 px. Every icon is that
mark in black: on white where an icon must be opaque (PWA, iOS), on transparent elsewhere (favicon,
extension). The site draws the same file as a CSS mask, so it takes the text colour. Outputs are committed.

  python3 apps/web/scripts/make-icons.py                      # redraw the icons from haven-mark.webp
  python3 apps/web/scripts/make-icons.py --from <black-on-white.png>   # replace the mark first, then redraw
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web/public"
EXT = ROOT / "apps/extension/public"
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


def icon(size: int, background: tuple | None, mark_share: float, ink=(0, 0, 0)) -> Image.Image:
    """The mark in ink, centred; on white for app icons that must be opaque, else on transparent."""
    mark = Image.open(MARK).convert("RGBA")
    m = round(size * 4 * mark_share)
    alpha = mark.getchannel("A").resize((m, m), Image.LANCZOS)
    s = size * 4
    out = Image.new("RGBA", (s, s), (*(background or (255, 255, 255)), 255 if background else 0))
    out.paste(Image.new("RGBA", (m, m), (*ink, 255)), ((s - m) // 2, (s - m) // 2), alpha)
    return out.resize((size, size), Image.LANCZOS)


def main() -> None:
    if "--from" in sys.argv:
        mark_from(Path(sys.argv[sys.argv.index("--from") + 1])).save(MARK, "WEBP", lossless=True, method=6)
    EXT.mkdir(parents=True, exist_ok=True)
    (EXT / "icon").mkdir(exist_ok=True)
    Image.open(MARK).save(EXT / "haven-mark.webp", "WEBP", lossless=True, method=6)
    white = (255, 255, 255)
    icon(512, white, 0.72).save(WEB / "icon-512.png", optimize=True)
    icon(192, white, 0.72).save(WEB / "icon-192.png", optimize=True)
    icon(512, white, 0.56).save(WEB / "icon-maskable-512.png", optimize=True)  # inside the maskable safe zone
    icon(180, white, 0.7).save(WEB / "apple-touch-icon.png", optimize=True)
    icon(64, None, 0.94).save(WEB / "favicon.png", optimize=True)
    for size in (16, 32, 48, 128):
        icon(size, None, 0.94).save(EXT / "icon" / f"{size}.png", optimize=True)

if __name__ == "__main__":
    main()
