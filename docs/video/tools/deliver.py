"""Builds the deliverables in out/ from a pair of silent renders.

  python3 tools/deliver.py WIDE.mp4 TALL.mp4

- out/homesync-16x9.mp4 and out/homesync-9x16.mp4: 1080p60 picture with the
  mastered mix (tools/master.py: -16 LUFS, -1.5 dBTP ceiling).
- out/homesync-music-only.m4a: the music alone, mastered to the same target.
- out/contact-sheet-16x9.png, out/contact-sheet-9x16.png: a frame every 0.5 s.
- out/measurements.json: the measured quality-bar numbers for both files.
"""

import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, cwd=ROOT).stdout


def frozen(video, window=None):
    args = ["python3", "tools/critic_kit.py", "frozen", video]
    if window:
        args += ["--window", str(window)]
    return json.loads(run(*args))


def loudness(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True, cwd=ROOT).stderr
    s = out[out.rfind("Summary:"):]
    pick = lambda key: float(s.split(key)[1].split()[0])
    return {"integrated_lufs": pick("I:"), "lra_lu": pick("LRA:"), "true_peak_dbfs": pick("Peak:")}


def probe(path):
    out = run("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
              "stream=width,height,r_frame_rate,nb_frames", "-of", "json", path)
    return json.loads(out)["streams"][0]


def main():
    wide, tall = sys.argv[1], sys.argv[2]
    out = os.path.join(ROOT, "out")
    os.makedirs(out, exist_ok=True)
    results = {}
    for name, src in (("16x9", wide), ("9x16", tall)):
        dst = f"out/homesync-{name}.mp4"
        run("python3", "tools/master.py", src, dst)
        os.remove(os.path.join(ROOT, f"out/homesync-{name}-mix.wav"))
        music = os.path.join(ROOT, f"out/homesync-{name}-music.m4a")
        if name == "16x9":
            shutil.move(music, os.path.join(out, "homesync-music-only.m4a"))
        else:
            os.remove(music)
        run("python3", "tools/critic_kit.py", "sheet", src, f"out/contact-sheet-{name}.png",
            "--every", "0.5", "--cols", "10" if name == "16x9" else "12", "--width", "320" if name == "16x9" else "180")
        results[name] = {
            "video": probe(dst),
            "frozen_adjacent_frames": frozen(src),
            "frozen_window_0.25s": frozen(src, 0.25),
            "loudness": loudness(dst),
        }
    results["music_only"] = {"loudness": loudness("out/homesync-music-only.m4a")}
    with open(os.path.join(out, "measurements.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(json.dumps({k: v.get("loudness") for k, v in results.items()}, indent=2))


if __name__ == "__main__":
    main()
