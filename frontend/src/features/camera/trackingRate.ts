import type { Landmark } from '../../../../model/prototype/pose'

/**
 * Tracking rate cap (settings › 개발자 옵션 › 추적 속도, 2026-10-13). `null` = device default
 * (30/s on GPU, 20/s on CPU). Kept per computer.
 */
const KEY = 'posegood.v2.trackingFps'

export function readTrackingFps(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY))
    return [30, 20, 15, 10].includes(value) ? value : null
  } catch {
    return null
  }
}

export function writeTrackingFps(fps: number | null) {
  try {
    if (fps) localStorage.setItem(KEY, String(fps))
    else localStorage.removeItem(KEY)
  } catch {
    /* Storage blocked: lasts for this run only. */
  }
}

/** Nose and both shoulders: the joints judging depends on. */
const JOINTS = [0, 11, 12]

/**
 * Shake of a still person: average spread of the nose and shoulders around their own mean,
 * in shoulder widths (so camera distance does not matter). Needs at least 10 frames with all
 * three joints. Lower is steadier.
 */
export function stillNoise(frames: Landmark[][], width: number, height: number): number | null {
  const usable = frames.filter((points) => JOINTS.every((j) => points[j] && (points[j].visibility ?? 0) >= 0.5))
  if (usable.length < 10) return null
  const span =
    usable.reduce((n, p) => n + Math.hypot((p[11].x - p[12].x) * width, (p[11].y - p[12].y) * height), 0) /
    usable.length
  if (span <= 0) return null
  let total = 0
  for (const j of JOINTS) {
    const mx = usable.reduce((n, p) => n + p[j].x, 0) / usable.length
    const my = usable.reduce((n, p) => n + p[j].y, 0) / usable.length
    total +=
      usable.reduce((n, p) => n + Math.hypot((p[j].x - mx) * width, (p[j].y - my) * height), 0) / usable.length
  }
  return total / JOINTS.length / span
}

export type RateResult = { fps: number; measuredFps: number; inferenceMs: number; noise: number | null }

/**
 * Steadiest rate; among rates within 10% of the steadiest, the fastest one (quicker response).
 * `null` when no rate had enough frames.
 */
export function recommendRate(results: RateResult[]): number | null {
  const scored = results.filter((r): r is RateResult & { noise: number } => r.noise !== null)
  if (!scored.length) return null
  const best = Math.min(...scored.map((r) => r.noise))
  return Math.max(...scored.filter((r) => r.noise <= best * 1.1).map((r) => r.fps))
}
