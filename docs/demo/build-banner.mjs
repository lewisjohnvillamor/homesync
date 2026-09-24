/**
 * Renders the project banner from `banner.html`.
 *
 *   node docs/demo/build-banner.mjs && python3 docs/demo/build-banner.py
 *
 * Chromium rather than an image library, because the banner is typography over
 * a gradient and a browser is the thing that lays type out properly. It renders
 * at twice the final size; `build-banner.py` scales the result down, which
 * comes out sharper than rendering at the final size directly.
 *
 * Requires Playwright; set PLAYWRIGHT_MODULE if it is not resolvable from here.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'banner-frames');

/**
 * The two shapes the banner is needed in.
 *
 * The wide one is the README's; the square-ish one is GitHub's social preview,
 * which is a different composition rather than the same one letterboxed — the
 * horizontal layout leaves a band of content floating in empty space at 1280 by
 * 640, so that variant stacks and centres instead.
 */
const VARIANTS = [
  { w: 1280, h: 400, unit: 63, pad: 54, gap: 52, figw: 690, out: 'banner.png' },
  { w: 1280, h: 640, unit: 68, pad: 76, gap: 40, figw: 680, out: 'banner-social.png', stacked: true },
];

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      const resolved = module.chromium ? module : module.default;
      if (resolved?.chromium) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Playwright not found. Install it, or set PLAYWRIGHT_MODULE.');
}

const { chromium } = await loadPlaywright();
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-proxy-server', '--force-color-profile=srgb', '--font-render-hinting=none'],
});

try {
  for (const variant of VARIANTS) {
    const page = await browser.newPage({
      viewport: { width: variant.w, height: variant.h },
      deviceScaleFactor: 2,
    });
    await page.goto(pathToFileURL(join(HERE, 'banner.html')).href);
    await page.addStyleTag({
      content:
        `.banner{--w:${variant.w}px;--h:${variant.h}px;--unit:${variant.unit}px;` +
        `--pad:${variant.pad}px;--gap:${variant.gap}px;--figw:${variant.figw}px}`,
    });
    if (variant.stacked) {
      await page.evaluate(() => document.querySelector('.banner').classList.add('stacked'));
    }
    // Web fonts are not used, but the gradient and the generated waveform both
    // need a frame to settle before the shot.
    await page.waitForTimeout(400);
    // The corners are rounded and must come out transparent rather than filled
    // with whatever the page behind them happened to be.
    await page.locator('.banner').screenshot({ path: join(OUT, variant.out), omitBackground: true });
    console.log(`${variant.out}  ${variant.w}x${variant.h} at 2x`);
    await page.close();
  }
} finally {
  await browser.close();
}
