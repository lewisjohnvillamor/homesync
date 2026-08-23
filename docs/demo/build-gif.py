#!/usr/bin/env python3
"""Assembles the frames captured by capture.mjs into the README's animation.

Run capture.mjs first; this only turns its output into a GIF.

    python3 docs/demo/build-gif.py

Two things keep the file small enough for a README. Consecutive frames that are
byte-identical are merged into one longer frame, which matters because most of
the recording is a still interface waiting for a clock to warm up — the capture
runs with reduced motion so that is literally true. And every
frame shares a single palette taken from the whole recording, so the decoder is
not asked to switch palettes mid-animation.
"""

import json
import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
FRAMES = HERE / "frames"
OUT = HERE.parent / "images" / "demo.gif"

# Cropped below the device panel's explanation: the panels under it are settings
# rather than the thing being demonstrated, and the last of them lands
# mid-sentence at this height.
CROP_HEIGHT = 772

# Wide enough that the telemetry figures stay legible, small enough for a
# README to load without thinking about it.
TARGET_WIDTH = 720

# A frame the recorder took while nothing was changing still deserves to be
# seen; anything longer than this is dead air and is trimmed back to it.
MAX_FRAME_MS = 1400


def load_frames():
    timing = json.loads((FRAMES / "timing.json").read_text())
    if not timing:
        sys.exit("no frames captured; run capture.mjs first")

    frames = []
    for index, entry in enumerate(timing):
        path = pathlib.Path(entry["path"])
        if not path.is_absolute():
            path = HERE.parent.parent / path
        nxt = timing[index + 1]["at"] if index + 1 < len(timing) else entry["at"] + 400
        frames.append((path, max(80, min(MAX_FRAME_MS, nxt - entry["at"]))))
    return frames


def main():
    raw = load_frames()

    images, durations = [], []
    previous_bytes = None
    for path, duration in raw:
        image = Image.open(path).convert("RGB")
        image = image.crop((0, 0, image.width, min(CROP_HEIGHT, image.height)))
        height = round(image.height * TARGET_WIDTH / image.width)
        image = image.resize((TARGET_WIDTH, height), Image.LANCZOS)

        current = image.tobytes()
        # A still interface should cost one frame, not thirty.
        if current == previous_bytes:
            durations[-1] = min(MAX_FRAME_MS, durations[-1] + duration)
            continue
        previous_bytes = current
        images.append(image)
        durations.append(duration)

    if not images:
        sys.exit("every frame was identical; nothing to animate")

    # One palette for the whole recording, built from a strip of frames spread
    # across it so a colour that only appears at the end still gets one.
    sample = Image.new("RGB", (images[0].width, images[0].height * min(6, len(images))))
    step = max(1, len(images) // 6)
    for slot, index in enumerate(range(0, len(images), step)):
        if slot >= 6:
            break
        sample.paste(images[index], (0, slot * images[0].height))
    palette = sample.quantize(colors=128, method=Image.MEDIANCUT)

    quantised = [image.quantize(palette=palette, dither=Image.NONE) for image in images]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    quantised[0].save(
        OUT,
        save_all=True,
        append_images=quantised[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )

    size = OUT.stat().st_size
    print(f"{OUT.relative_to(HERE.parent.parent)}: {len(quantised)} frames, {size / 1_000_000:.2f} MB")
    print(f"runs for {sum(durations) / 1000:.1f} s at {quantised[0].width}x{quantised[0].height}")


if __name__ == "__main__":
    main()
