/**
 * The three devices the film follows: a laptop, a phone and a TV.
 *
 * Line drawings in the app's own stroke weights and colours, as SVG strings
 * scaled to any size, so every scene that shows a device shows the same one —
 * a device keeps its identity across shots the way the dot does.
 *
 * Each drawing has a `.screen` rect that scenes light up or draw into.
 */

const STROKE = '#2f3b4a';
const SCREEN = '#12171f';

/** Aspect ratios (width / height) of each drawing's viewBox. */
export const ASPECT = { laptop: 1.5, phone: 0.5, tv: 1.62 };

export function laptopSvg() {
  return `<svg viewBox="0 0 300 200" class="device device-laptop" fill="none" stroke-linejoin="round">
    <rect x="42" y="14" width="216" height="140" rx="10" fill="#0e131a" stroke="${STROKE}" stroke-width="4"/>
    <rect class="screen" x="52" y="24" width="196" height="120" rx="4" fill="${SCREEN}"/>
    <path d="M12 168h276l-14 18H26z" fill="#141a22" stroke="${STROKE}" stroke-width="4"/>
    <path d="M128 168h44" stroke="#3a4757" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

export function phoneSvg() {
  return `<svg viewBox="0 0 120 240" class="device device-phone" fill="none" stroke-linejoin="round">
    <rect x="4" y="4" width="112" height="232" rx="20" fill="#0e131a" stroke="${STROKE}" stroke-width="4"/>
    <rect class="screen" x="12" y="20" width="96" height="200" rx="8" fill="${SCREEN}"/>
    <rect x="46" y="10" width="28" height="4" rx="2" fill="${STROKE}"/>
  </svg>`;
}

export function tvSvg() {
  return `<svg viewBox="0 0 324 200" class="device device-tv" fill="none" stroke-linejoin="round">
    <rect x="6" y="6" width="312" height="170" rx="8" fill="#0e131a" stroke="${STROKE}" stroke-width="4"/>
    <rect class="screen" x="16" y="16" width="292" height="150" rx="3" fill="${SCREEN}"/>
    <path d="M132 176l-10 18M192 176l10 18M110 194h104" stroke="${STROKE}" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

export const DEVICE_SVG = { laptop: laptopSvg, phone: phoneSvg, tv: tvSvg };

/** The play glyph used on a device screen. */
export function playGlyph(size, color = '#5aa9ff') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M8 5.5v13l11-6.5z" fill="${color}"/></svg>`;
}

/**
 * The HomeSync mark without its centre: two pairs of arcs, as in
 * web/src/index.html. The centre is the dot, which belongs to the film.
 */
export function arcsSvg(stroke = '#5aa9ff') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" class="arcs">
    <path class="arc-inner-l" d="M6.5 7.5a7 7 0 0 0 0 9"/>
    <path class="arc-inner-r" d="M17.5 7.5a7 7 0 0 1 0 9"/>
    <path class="arc-outer-l" d="M3.5 4.5a11 11 0 0 0 0 15"/>
    <path class="arc-outer-r" d="M20.5 4.5a11 11 0 0 1 0 15"/>
  </svg>`;
}

/**
 * The mark's geometry, so the dot can sit exactly at its centre: the centre
 * circle has radius 3 in a 24-unit box, so its diameter is a quarter of the
 * mark's size.
 */
export const MARK_DOT_RATIO = 6 / 24;
