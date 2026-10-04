/**
 * The model house's camera, shared by composition 8 (whose flat diagram tilts
 * to exactly this angle and lifts away) and composition 9 (which is waiting
 * underneath at this angle). One number, so the hand-over cannot drift.
 */
export const HOUSE_VIEW = {
  /** Degrees above the horizon. Within the 35–55° the 3D rules allow. */
  elevation: 45,
  /** Degrees around the vertical; 0 looks straight along −z. */
  azimuth: -28,
  /** Vertical field of view, degrees. */
  fov: 30,
};

/**
 * When the three bars touch the plane of light inside the house — the film's
 * one "arrival" moment, which the score marks with its only chime.
 */
export const HOUSE_TOUCH = 20.625; // beat 33 — on the grid, so the chime lands on a beat, and ~1 s of payoff before the dot leaves
