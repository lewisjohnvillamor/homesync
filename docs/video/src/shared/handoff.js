/**
 * Positions one scene publishes for another, every frame.
 *
 * The lag markers live on the 3D floor in compositions 1–2 and fly into the
 * full stop in composition 3. Composition 1's frame hook projects them to
 * frame pixels and writes them here; composition 3's hook, which runs after
 * it, reads them. Both are functions of the frame time alone, so this is as
 * deterministic as everything else.
 */
export const handoff = {
  /**
   * Lag markers in frame pixels at time t: set by composition 1, read by 3.
   * @type {((t:number) => {x:number,y:number,d:number}[]) | null}
   */
  markersAt: null,
  /**
   * Composition 3's full stop at time t: set by composition 3, read by 4.
   * @type {((t:number) => {x:number,y:number,d:number}) | null}
   */
  stopAt: null,
};
