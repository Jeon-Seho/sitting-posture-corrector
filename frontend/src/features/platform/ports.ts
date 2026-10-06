/**
 * DRAFT connection points for the planned posture platform (architecture v4, 2026-10-02).
 *
 * Nothing in the app imports an implementation of these yet, and no network call is made
 * from here. They exist so the backend/realtime work can be plugged in behind the screens
 * without redesigning them. Field names follow the v4 overview and are NOT a contract:
 * the agreed JSON lives in contracts/ once the team fixes it (fps, window, T1/T2/T3 are
 * still draft values). See docs/design/frontend-platform-seams.md for the screen mapping.
 */
import type { CollapseType } from '../../data/posture'

/** REST via the API gateway (:8080). JWT handling is decided with the gateway team. */
export interface AuthPort {
  signIn(email: string, password: string): Promise<{ userId: string; displayName: string }>
  signOut(): Promise<void>
}

/** POST /api/baselines — about 5 s of upright keypoints; the server keeps versions. */
export interface BaselinePort {
  save(frames: KeypointFrame[]): Promise<{ baselineVersion: number }>
  /** Lets an auto-started desktop app skip re-registration when a baseline exists. */
  latest(): Promise<{ baselineVersion: number; savedAt: string } | null>
}

/** One pose sample. The v4 plan sends keypoints; ADR 0013 currently sends only deltas. */
export type KeypointFrame = {
  t: number
  /** MediaPipe landmark index → normalised x, y, visibility. */
  points: [number, number, number][]
}

/**
 * The realtime WebSocket seam is implemented: features/session/realtime/client.ts against
 * contracts/realtime (draft, GP-0115). It sends input v2 deltas (ADR 0013), not keypoints, and the
 * server session controller uses it when VITE_REALTIME_URL is set.
 */

/** report-service: single episodes are immediate, daily/weekly figures come from the mart. */
export interface ReportPort {
  daily(range: { from: string; to: string }): Promise<DailyPosture[]>
}

export type DailyPosture = {
  date: string
  validSeconds: number
  goodSeconds: number
  episodes: number
  alerts: number
  byCollapse: Partial<Record<CollapseType, number>>
}
