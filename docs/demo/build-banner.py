#!/usr/bin/env python3
"""Turns the rendered banner frames into the committed assets.

Run build-banner.mjs first; this only scales and encodes what it produced.

    python3 docs/demo/build-banner.py

The two outputs are deliberately different formats.

The README's banner is WebP because the background is a smooth gradient, which
is the thing PNG compresses worst: the same image is 621 kB as a PNG and 64 kB
as WebP at quality 95, with no ringing visible around the wordmark even
magnified. GitHub renders WebP in a README.

The social preview is PNG because GitHub's uploader for it takes PNG, JPEG or
GIF and not WebP, at the 1280x640 it asks for.
"""

import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
FRAMES = HERE / "banner-frames"
OUT = HERE.parent / "images"

# (source, final size, destination, encoder arguments)
ASSETS = [
    ("banner.png", (1920, 600), "banner.webp", {"quality": 95, "method": 6}),
    ("banner-social.png", (1280, 640), "banner-social.png", {"optimize": True, "compress_level": 9}),
]


def main():
    if not FRAMES.is_dir():
        sys.exit("no rendered frames; run build-banner.mjs first")

    OUT.mkdir(parents=True, exist_ok=True)
    for source, size, destination, options in ASSETS:
        path = FRAMES / source
        if not path.is_file():
            sys.exit(f"{path} is missing; run build-banner.mjs first")

        # Rendered at twice this and scaled down here, which is sharper than
        # asking the browser for the final size.
        # RGBA, not RGB: the rounded corners are transparent and flattening
        # them onto white would draw four bright wedges.
        image = Image.open(path).convert("RGBA").resize(size, Image.LANCZOS)
        target = OUT / destination
        image.save(target, **options)
        print(f"{target.relative_to(HERE.parent.parent)}  {target.stat().st_size / 1024:.0f} kB  {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
