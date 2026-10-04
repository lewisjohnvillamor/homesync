"""Measurement tools for critics. Critics run these themselves.

  python3 tools/critic_kit.py sheet    VIDEO OUT.png [--every 0.2] [--from S] [--to S] [--cols 10]
  python3 tools/critic_kit.py dense    VIDEO OUT.png --at T [--fps 20] [--span 1.0]
  python3 tools/critic_kit.py frozen   VIDEO [--threshold 0.6]
  python3 tools/critic_kit.py loudness VIDEO_OR_WAV
  python3 tools/critic_kit.py frame    VIDEO OUT.png --at T
  python3 tools/critic_kit.py contrast IMAGE.png X1 Y1 X2 Y2

`sheet` labels every tile with its time. `dense` samples a window around a
moment at a high rate, for judging a transition. `frozen` reports how much of
the film is visually still: a frame counts as frozen when the mean absolute
change from the previous frame (greyscale, 320 px wide) is below the
threshold, in 0–255 levels. `contrast` reports the WCAG contrast between the
lightest and darkest pixels inside a rectangle — draw it tightly around a
line of text.
"""

import argparse
import json
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw


def probe(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
         "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    s = info["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(num) / float(den), float(info["format"]["duration"])


def frames(video, width, fps=None, start=None, end=None):
    """Yields (time, greyscale-or-rgb array) at the video's rate or `fps`."""
    w, h, rate, _ = probe(video)
    height = round(h * width / w / 2) * 2
    args = ["ffmpeg", "-v", "error"]
    if start is not None:
        args += ["-ss", f"{start}"]
    args += ["-i", video]
    if end is not None:
        args += ["-t", f"{end - (start or 0)}"]
    vf = f"scale={width}:{height}:flags=area"
    if fps:
        vf = f"fps={fps}," + vf
    args += ["-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE)
    size = width * height * 3
    step = 1 / (fps or rate)
    i = 0
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield (start or 0) + i * step, np.frombuffer(buf, np.uint8).reshape(height, width, 3)
        i += 1


def tile(images, labels, cols, out):
    h, w = images[0].shape[:2]
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), "black")
    draw = ImageDraw.Draw(sheet)
    for i, (img, label) in enumerate(zip(images, labels)):
        x, y = (i % cols) * w, (i // cols) * h
        sheet.paste(Image.fromarray(img), (x, y))
        draw.rectangle([x, y, x + 64, y + 16], fill=(0, 0, 0))
        draw.text((x + 3, y + 2), label, fill=(255, 220, 0))
    sheet.save(out)
    print(f"{len(images)} tiles -> {out}")


def cmd_sheet(a):
    fps = 1 / a.every
    imgs, labels = [], []
    for t, img in frames(a.video, a.width, fps=fps, start=a.start, end=a.end):
        imgs.append(img)
        labels.append(f"{t:6.2f}s")
    tile(imgs, labels, a.cols, a.out)


def cmd_dense(a):
    start = max(0, a.at - a.span / 2)
    imgs, labels = [], []
    for t, img in frames(a.video, a.width, fps=a.fps, start=start, end=start + a.span):
        imgs.append(img)
        labels.append(f"{t:6.3f}s")
    tile(imgs, labels, a.cols, a.out)


def cmd_frozen(a):
    _, _, rate, duration = probe(a.video)
    prev = None
    still = []
    diffs = []
    for t, img in frames(a.video, 320):
        g = img.astype(np.float32).mean(axis=2)
        if prev is not None:
            d = float(np.abs(g - prev).mean())
            diffs.append((t, d))
            still.append(d < a.threshold)
        prev = g
    frozen_s = sum(still) / rate
    longest, run, run_start, worst = 0, 0, 0, (0, 0)
    for i, s in enumerate(still):
        if s:
            if run == 0:
                run_start = diffs[i][0]
            run += 1
            if run > longest:
                longest = run
                worst = (run_start, diffs[i][0])
        else:
            run = 0
    # Every stretch longer than 0.3 s, so a critic can look at each.
    stretches, run = [], 0
    for i, s in enumerate(still + [False]):
        if s:
            if run == 0:
                run_start = diffs[i][0]
            run += 1
        else:
            if run / rate > 0.3:
                stretches.append((round(run_start, 3), round(run / rate, 3)))
            run = 0
    print(json.dumps({
        "duration_s": round(duration, 3),
        "frozen_total_s": round(frozen_s, 3),
        "frozen_per_30s": round(frozen_s * 30 / duration, 3),
        "longest_still_s": round(longest / rate, 3),
        "longest_still_from_to": [round(worst[0], 3), round(worst[1], 3)],
        "still_stretches_over_0.3s": stretches,
        "threshold_levels": a.threshold,
    }, indent=2))


def cmd_loudness(a):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", a.path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    summary = out[out.rfind("Summary:"):]
    print(summary.strip())


def cmd_frame(a):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a.at}", "-i", a.video, "-frames:v", "1", a.out], check=True)
    print(a.out)


def luminance(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def cmd_contrast(a):
    img = np.asarray(Image.open(a.image).convert("RGB")).astype(np.float64)
    region = img[a.y1:a.y2, a.x1:a.x2].reshape(-1, 3)
    lum = luminance(region)
    # Text is the brightest 5 %, its ground the darkest 50 %: robust to
    # anti-aliased edges.
    hi = np.percentile(lum, 97)
    lo = np.percentile(lum, 30)
    ratio = (max(hi, lo) + 0.05) / (min(hi, lo) + 0.05)
    print(json.dumps({"contrast_ratio": round(float(ratio), 2), "passes_4.5": bool(ratio >= 4.5)}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheet"); s.add_argument("video"); s.add_argument("out")
    s.add_argument("--every", type=float, default=0.2); s.add_argument("--from", dest="start", type=float)
    s.add_argument("--to", dest="end", type=float); s.add_argument("--cols", type=int, default=10)
    s.add_argument("--width", type=int, default=240); s.set_defaults(fn=cmd_sheet)
    d = sub.add_parser("dense"); d.add_argument("video"); d.add_argument("out"); d.add_argument("--at", type=float, required=True)
    d.add_argument("--fps", type=float, default=20); d.add_argument("--span", type=float, default=1.0)
    d.add_argument("--cols", type=int, default=10); d.add_argument("--width", type=int, default=320); d.set_defaults(fn=cmd_dense)
    f = sub.add_parser("frozen"); f.add_argument("video"); f.add_argument("--threshold", type=float, default=0.6); f.set_defaults(fn=cmd_frozen)
    l = sub.add_parser("loudness"); l.add_argument("path"); l.set_defaults(fn=cmd_loudness)
    fr = sub.add_parser("frame"); fr.add_argument("video"); fr.add_argument("out"); fr.add_argument("--at", type=float, required=True); fr.set_defaults(fn=cmd_frame)
    c = sub.add_parser("contrast"); c.add_argument("image")
    for k in ("x1", "y1", "x2", "y2"):
        c.add_argument(k, type=int)
    c.set_defaults(fn=cmd_contrast)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
