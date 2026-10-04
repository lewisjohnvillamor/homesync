/**
 * The timing diagram's geometry, shared by compositions 5–8.
 *
 * Composition 5's phone shrinks into the phone lane's icon here, so both
 * scenes must agree on exactly where that icon is. Positions are in frame
 * pixels for the diagram's resting, flat, plan-view framing (composition 6).
 */

/** Delays shown on the bars, in ms — facts.md F8, always labelled "example". */
export const DELAY_MS = { laptop: 40, phone: 90, tv: 210 };

export function diagramLayout(W, H, u, portrait) {
  const lanes = portrait
    ? { laptop: H * 0.42, phone: H * 0.56, tv: H * 0.7 }
    : { laptop: H * 0.42, phone: H * 0.6, tv: H * 0.78 };
  const iconX = portrait ? 120 * u : 210 * u;
  const laneStart = portrait ? 210 * u : 330 * u;
  const laneEnd = portrait ? W - 70 * u : W - 150 * u;
  const tX = portrait ? W * 0.74 : W * 0.66;
  /** Pixels per millisecond of delay: the TV's 210 ms bar must fit left of T. */
  const pxPerMs = (tX - laneStart - 90 * u) / 210;
  return {
    lanes,
    iconX,
    /** The phone icon's box: composition 5's phone lands exactly here. */
    phoneIcon: { x: iconX, y: lanes.phone, h: 96 * u, w: 48 * u },
    laneStart,
    laneEnd,
    tX,
    /** Where the dot sits as the instant T: above the top lane. */
    tTop: lanes.laptop - (portrait ? 150 * u : 120 * u),
    pxPerMs,
  };
}
