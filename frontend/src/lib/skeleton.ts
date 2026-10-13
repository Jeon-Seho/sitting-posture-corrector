import type { Landmark } from '../../../model/prototype/pose'

/**
 * Display only. Never feed filtered points into inference, calibration or CSV.
 *
 * 2026-10-13: the skeleton jittered and jumped. A fixed 45 ms average followed MediaPipe's
 * frame-to-frame noise, and points near the visibility limit skipped smoothing and made
 * edges blink. Now each coordinate goes through a One Euro filter (steady when still,
 * responsive when moving) and visibility is averaged, so a joint near the limit fades
 * instead of flickering.
 */
const MIN_CUTOFF_HZ = 1.2
/** Normalized image units per second; faster movement raises the cutoff (less lag). */
const BETA = 8
const DERIVATIVE_CUTOFF_HZ = 1
const VISIBILITY_TAU_MS = 160

const smoothing = (cutoffHz: number, dtSec: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dtSec)
}

type Channel = { value: number; speed: number }

function step(channel: Channel | undefined, raw: number, dtSec: number): Channel {
  if (!channel) return { value: raw, speed: 0 }
  const speed = channel.speed + smoothing(DERIVATIVE_CUTOFF_HZ, dtSec) * ((raw - channel.value) / dtSec - channel.speed)
  const cutoff = MIN_CUTOFF_HZ + BETA * Math.abs(speed)
  return { value: channel.value + smoothing(cutoff, dtSec) * (raw - channel.value), speed }
}

type PointState = { x: Channel; y: Channel; z: Channel; visibility: number }

export type PointFilter = {
  /** Filters one detection; `target` is the raw landmark list (may be empty). */
  next: (target: Landmark[], dtMs: number) => Landmark[]
  reset: () => void
}

export function createPointFilter(): PointFilter {
  let state: PointState[] = []
  return {
    next(target, dtMs) {
      if (!target.length) return []
      const dtSec = Math.max(1, dtMs) / 1000
      const v = 1 - Math.exp(-Math.max(1, dtMs) / VISIBILITY_TAU_MS)
      state = target.map((point, i) => {
        const old = state[i]
        return {
          x: step(old?.x, point.x, dtSec),
          y: step(old?.y, point.y, dtSec),
          z: step(old?.z, point.z, dtSec),
          visibility: old ? old.visibility + ((point.visibility ?? 0) - old.visibility) * v : (point.visibility ?? 0),
        }
      })
      return target.map((point, i) => ({
        ...point,
        x: state[i].x.value,
        y: state[i].y.value,
        z: state[i].z.value,
        visibility: state[i].visibility,
      }))
    },
    reset() {
      state = []
    },
  }
}

export function inferenceInterval(delegate: 'GPU' | 'CPU', inferenceMs: number) {
  // Leave time for rendering and input, especially on CPU fallback.
  return Math.max(delegate === 'GPU' ? 1000 / 30 : 1000 / 20, inferenceMs * 2)
}
