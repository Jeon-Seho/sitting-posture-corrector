import { featureDeltas } from '../../../../model/prototype/serverFeatures'
import type { Features } from '../../../../model/prototype/pose'
import type { Rules } from '../../lib/engine'
import { policyFor, type FrameRequest } from './server/contracts'
import { ReturnSettle } from '../../lib/returnSettle'

const FRAME_EXPIRY_MS = 1000
const MAX_INTERVAL_MS = 1500
const MAX_SESSION_MS = 86_400_000
/** About one hour at 30 fps; later intervals are not kept in memory. */
export const MAX_EXPORT_INTERVALS = 108_000

type Meta = {
  sessionId: string
  userId: string
  baselineId: string
  baseline: Features
  rules: Rules
  width: number
  height: number
  /** performance.now() at session start; interval times are relative to it. */
  origin: number
  startedAt: string
}

/**
 * Collects, in memory, the input v2 intervals a local measurement would have sent to
 * posture.features.v1 (contracts/realtime). Nothing is written until the user exports.
 * Same interval rules as the server controller: adjacent real frames only, gaps over 1 s
 * stay gaps, paused time is not recorded.
 */
export class KafkaFeatureRecorder {
  private readonly items: FrameRequest[] = []
  private previous: { timeMs: number; usable: boolean } | null = null
  private readonly settle = new ReturnSettle()
  private lastEnd = -1
  truncated = false

  constructor(private readonly meta: Meta) {}

  get count() {
    return this.items.length
  }

  /** Breaks the interval chain, e.g. on pause, so no interval spans unobserved time. */
  pause() {
    this.previous = null
  }

  push(timeMs: number, features: Features | null) {
    if (!Number.isFinite(timeMs)) return
    const previous = this.previous
    const measured = featureDeltas(features, this.meta.baseline)
    // Same return-settle rule as the server controller: just after unknown is still poor.
    const judged = this.settle.judge(timeMs, measured !== null)
    this.previous = { timeMs, usable: judged }
    if (!previous) return
    const gap = timeMs - previous.timeMs
    if (gap <= 0 || gap > FRAME_EXPIRY_MS) return
    const start = Math.round(previous.timeMs - this.meta.origin)
    const end = Math.round(timeMs - this.meta.origin)
    if (start < 0 || start < this.lastEnd || end <= start || end - start > MAX_INTERVAL_MS || end > MAX_SESSION_MS)
      return
    if (this.items.length >= MAX_EXPORT_INTERVALS) {
      this.truncated = true
      return
    }
    const usable = previous.usable && judged ? measured : null
    this.items.push({
      schema_version: '2.0',
      feature_version: 'shoulder-relative-deltas-v1',
      baseline_id: this.meta.baselineId,
      sequence: this.items.length,
      start_ms: start,
      end_ms: end,
      phase: 'running',
      measurement_quality: usable ? 'good' : 'poor',
      features: usable,
    })
    this.lastEnd = end
  }

  /** JSON Lines in posture.features.v1 envelopes: session_started, features…, session_ended. */
  toText(endedAt = new Date()) {
    const start = Date.parse(this.meta.startedAt)
    const endMs = Math.max(this.lastEnd, 0)
    const envelope = (kind: string, body: object, offsetMs: number) => ({
      schema_version: '1.0',
      message_id: crypto.randomUUID(),
      session_id: this.meta.sessionId,
      user_id: this.meta.userId,
      produced_at: new Date((Number.isFinite(start) ? start : endedAt.getTime()) + offsetMs).toISOString(),
      kind,
      body,
    })
    const lines = [
      envelope(
        'session_started',
        {
          policy: policyFor(this.meta.rules),
          baseline_id: this.meta.baselineId,
          frame: { width: this.meta.width, height: this.meta.height },
        },
        0,
      ),
      ...this.items.map((item) => envelope('features', item, item.end_ms)),
      envelope('session_ended', { end_ms: endMs }, endMs),
    ]
    return lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
  }
}
