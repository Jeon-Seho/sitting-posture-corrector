/** How long a user who just came back into view is left to settle before being judged. */
export const RETURN_SETTLE_MS = 3000

/**
 * Holds the judgement after an unmeasurable observation: the user is still getting back
 * into position, so neither good nor collapse is decided yet. The live screen, the frames
 * sent to the server and both exports share this rule so they never disagree.
 */
export class ReturnSettle {
  private lastUnmeasurableMs = -Infinity

  constructor(private readonly settleMs = RETURN_SETTLE_MS) {}

  /** Feed observations in time order; true when this one may be judged. */
  judge(timeMs: number, measurable: boolean) {
    if (!measurable) {
      this.lastUnmeasurableMs = timeMs
      return false
    }
    return timeMs - this.lastUnmeasurableMs >= this.settleMs
  }
}
