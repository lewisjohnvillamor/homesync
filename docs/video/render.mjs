/**
 * Renders a page's GSAP timeline to video, one frame at a time.
 *
 * A page opts in by defining `window.__film`:
 *
 *   { ready: Promise, duration: seconds, seek(t) }
 *
 * `seek` must put every pixel on screen as a function of `t` alone — the
 * timeline is paused and nothing runs on a timer — so a frame renders the
 * same whether it is the first one drawn or the thousandth, and whichever
 * worker draws it.
 *
 *   node render.mjs --page src/film.html --w 1920 --h 1080 --out out/film.mp4
 *   node render.mjs --page src/film.html --stills 0,1.5,3 --out work/stills
 *
 * Options: --fps (60) --from (0) --to (page duration) --workers (4)
 *          --param key=value (repeatable; passed to the page as query string)
 */

import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { fps: 60, workers: 4, w: 1920, h: 1080, params: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'param') args.params.push(value);
    else args[key] = value;
    i += 1;
  }
  for (const n of ['fps', 'workers', 'w', 'h']) args[n] = Number(args[n]);
  if (args.from !== undefined) args.from = Number(args.from);
  if (args.to !== undefined) args.to = Number(args.to);
  return args;
}

async function loadPlaywright() {
  for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    if (!candidate) continue;
    try {
      const module = await import(candidate);
      const resolved = module.chromium ? module : module.default;
      if (resolved?.chromium) return resolved;
    } catch {
      // Next.
    }
  }
  throw new Error('Playwright is required to render');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

/** Serves this directory, so pages load pinned local files and nothing else. */
function serve() {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = resolve(ROOT, `.${path}`);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function run(command, args) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${command} exited ${code}\n${err.slice(-2000)}`))));
  });
}

async function openPage(browser, url, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__film !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => window.__film.ready);
  return { page, errors };
}

async function seekAndShoot(page, t, path) {
  await page.evaluate((time) => window.__film.seek(time), t);
  await page.screenshot({ path, type: 'png', animations: 'disabled', caret: 'hide' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.page || !args.out) throw new Error('--page and --out are required');

  const playwright = await loadPlaywright();
  const server = await serve();
  const query = args.params.length ? `?${args.params.join('&')}` : '';
  const url = `http://127.0.0.1:${server.address().port}/${args.page}${query}`;
  const browser = await playwright.chromium.launch({
    // WebGL through SwiftShader: slower than a GPU, and identical on every run,
    // which is the property that matters here.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--font-render-hinting=none'],
  });

  try {
    const probe = await openPage(browser, url, args.w, args.h);
    const duration = await probe.page.evaluate(() => window.__film.duration);
    await probe.page.close();

    if (args.stills !== undefined) {
      await mkdir(args.out, { recursive: true });
      const { page, errors } = await openPage(browser, url, args.w, args.h);
      for (const t of String(args.stills).split(',').map(Number)) {
        await seekAndShoot(page, t, join(args.out, `t${t.toFixed(2).padStart(6, '0')}.png`));
      }
      if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
      console.log(`stills -> ${args.out}`);
      return;
    }

    const from = args.from ?? 0;
    const to = Math.min(args.to ?? duration, duration);
    const total = Math.round((to - from) * args.fps);
    const framesDir = join(ROOT, 'frames', args.out.replace(/[^\w.-]/g, '_'));
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });

    const started = Date.now();
    let done = 0;
    const worker = async (index) => {
      const { page, errors } = await openPage(browser, url, args.w, args.h);
      for (let frame = index; frame < total; frame += args.workers) {
        // Frame centres are not used: frame n shows time n / fps exactly, so a
        // cut placed on a beat lands on a frame boundary.
        const t = from + frame / args.fps;
        await seekAndShoot(page, t, join(framesDir, `${String(frame).padStart(5, '0')}.png`));
        done += 1;
        if (done % 120 === 0) {
          const rate = done / ((Date.now() - started) / 1000);
          process.stdout.write(`  ${done}/${total} frames, ${rate.toFixed(1)}/s\n`);
        }
      }
      if (errors.length) throw new Error(`page errors in worker ${index}:\n${errors.join('\n')}`);
      await page.close();
    };
    await Promise.all(Array.from({ length: args.workers }, (_, i) => worker(i)));

    await mkdir(dirname(resolve(args.out)), { recursive: true });
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-framerate', String(args.fps),
      '-i', join(framesDir, '%05d.png'),
      // Convert with the BT.709 matrix the file is tagged with; swscale's
      // default is BT.601, which decodes the accent ~10 levels off in red.
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15',
      // Gradients on a near-black ground band badly at default settings.
      '-tune', 'film', '-x264-params', 'aq-mode=3',
      '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-movflags', '+faststart',
      args.out,
    ]);
    console.log(`${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s -> ${args.out}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
