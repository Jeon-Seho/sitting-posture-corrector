/** How long a user who just came back into view is left to settle before being judged. */
export const RETURN_SETTLE_MS = 3000
/** A turned head returns to the screen quickly; hold the judgement only briefly. */
export const TURN_SETTLE_MS = 1000

/** What an observation was: judgeable, not measurable (away, hidden) or a turned head. */
export type Observed = 'measurable' | 'unmeasurable' | 'head_turn'

/**
 * Holds the judgement after an unjudged observation: the user is still getting back
 * into position, so neither good nor collapse is decided yet. The live screen, the frames
 * sent to the server and both exports share this rule so they never disagree.
 */
export class ReturnSettle {
  private holdUntilMs = -Infinity

  /** Feed observations in time order; true when this one may be judged. */
  judge(timeMs: number, observed: Observed | boolean) {
    const kind = observed === true ? 'measurable' : observed === false ? 'unmeasurable' : observed
    if (kind === 'measurable') return timeMs >= this.holdUntilMs
    const hold = kind === 'head_turn' ? TURN_SETTLE_MS : RETURN_SETTLE_MS
    this.holdUntilMs = Math.max(this.holdUntilMs, timeMs + hold)
    return false
  }
}
