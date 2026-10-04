# Building a scene

Read `storyboard.md` (the plan), `rules.md` (the bar) and `facts.md` (the
only source for on-screen claims) first.

## The contract

A scene is `src/scenes/sNN-name.js`, named as in `src/shared/beats.js`, and
listed in `src/scenes/index.js` (`BUILT`). It exports:

```js
export const pad = [before, after]; // seconds the layer stays visible outside its slot (optional)
export function build(ctx) { … }
```

`ctx` gives you:

| | |
| --- | --- |
| `el` | your scene's layer: an absolutely positioned div the size of the frame |
| `tl` | the film's single paused GSAP timeline — add tweens at **absolute** times |
| `t0`, `t1` | your composition's start and end, in seconds |
| `W`, `H` | frame size in px (1920×1080 or 1080×1920) |
| `portrait` | `H > W` |
| `u` | one design unit: px per 1/1080 of the frame's short side |
| `onFrame(fn)` | `fn(t)` runs on every frame after the timeline is seeked — use it for anything GSAP can't tween (three.js renders, positions read from 3D) |
| `hostDot(a, b, at)` | you own the film's dot from `a` to `b`; `at(t)` returns `{x, y, d, glow?, opacity?}` in frame px. Between hosts the film flies the dot for you on an eased arc from where the last host left it to where the next one picks it up |
| `waitFor(promise)` | the first frame waits for it (fonts, layout measurement) |

## Non-negotiable

- **Every value is a function of `t` alone.** No `Date`, no
  `requestAnimationFrame`, no timers, no CSS transitions or animations, no
  `Math.random` (use `rng(seed)` from `beats.js`). No state remembered from a
  previous frame: frames are drawn out of order by several workers.
- **Never edit** `src/film.js`, `src/shared/*` or another scene's file. If you
  need a shared change, say so in your report.
- **Colours** are the tokens in `src/shared/tokens.css` only. Type is Inter
  (`var(--sans)`) and JetBrains Mono (`var(--mono)`).
- **Text over picture** sits on `.band` or plain ground. Contrast ≥ 4.5:1.
- **Nothing flies through other text.** Nothing is still for more than 0.5 s:
  every hold has a slow push or drift.
- **Things land slowly and leave fast.** No linear motion except slow pushes.
- **Only facts.md wording** on screen. Every number is labelled as an example
  where facts.md says so.
- **3D** (three.js only): use `src/shared/three-kit.js` — `makeRenderer`,
  `makeStage`, `MAKE.laptop/phone/tv`, `toScreen`. Camera 35–55°. Labels are
  HTML positioned from `toScreen` each frame, never text in 3D. Measure the
  rendered background pixel against `#0b0e13`.

## Checking your work

```sh
node render.mjs --page src/film.html --stills 18.2,19,20 --out work/mine          # 16:9
node render.mjs --page src/film.html --w 1080 --h 1920 --stills 19 --out work/mine-v  # 9:16
node render.mjs --page src/film.html --param solo=9 --from 18.1 --to 21.9 --out work/s09.mp4
```

`--param solo=N` shows only your scene (and the dot while you host it).
`--param debug=1` prints the time and composition number in a corner.
Look at your stills. Fix what is wrong before reporting.
