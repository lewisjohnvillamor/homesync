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
  /**
   * Composition 10's dot (its arrival size) at time t: set by composition 10,
   * read by composition 9 so its dot comes forward on to the same pixels.
   * @type {((t:number) => {x:number,y:number,d:number}) | null}
   */
  lanDotAt: null,
  /**
   * Composition 5's dot at time t, from its first frame: set by composition 5,
   * read by composition 4 so its leaving dot lands on the same pixels and size.
   * @type {((t:number) => {x:number,y:number,d:number}) | null}
   */
  joinDotAt: null,
  /**
   * Composition 8's dot as it lets go over the house (17.90): set by
   * composition 6, read by composition 9, which starts from that exact point
   * and size and eases to its own hover.
   * @type {((t:number) => {x:number,y:number,d:number}) | null}
   */
  liftDotAt: null,
};
