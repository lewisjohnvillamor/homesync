"""Masters the audio and puts it under the picture.

  python3 tools/master.py VIDEO.mp4 OUT.mp4 [--audio work/audio]

Two-pass EBU R128 normalisation to -16 LUFS integrated with a -1.5 dBTP
ceiling — a comfortable level for web playback with headroom against
clipping. The mix and the music-only version are normalised separately, each
to the same target, and the music-only version is written beside OUT as
OUT-music.m4a (and the full mix's audio as OUT-mix.wav for measurement).
"""

import argparse
import json
import subprocess

TARGET = -16.0
TRUE_PEAK = -1.5
LRA = 7.0


def measure(path):
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
         f"loudnorm=I={TARGET}:TP={TRUE_PEAK}:LRA={LRA}:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    return json.loads(out[out.rfind("{"):])


def normalise(src, dst, extra=()):
    m = measure(src)
    flt = (f"loudnorm=I={TARGET}:TP={TRUE_PEAK}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
           f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", f"{flt},aresample=48000", *extra, dst], check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("out")
    p.add_argument("--audio", default="work/audio")
    a = p.parse_args()
    base = a.out[:-4]
    normalise(f"{a.audio}/mix.wav", f"{base}-mix.wav")
    normalise(f"{a.audio}/music.wav", f"{base}-music.m4a", ("-c:a", "aac", "-b:a", "256k"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.video, "-i", f"{base}-mix.wav", "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", a.out], check=True)
    print(f"{a.out}, {base}-music.m4a")


if __name__ == "__main__":
    main()
