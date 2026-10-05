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
import type { LiveStatus } from '../session/liveView'

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

/** WebSocket: client batches ~0.5 s of frames, server pushes decisions and alerts. */
export interface RealtimePort {
  open(sessionId: string, handlers: RealtimeHandlers): RealtimeConnection
}

export type RealtimeHandlers = {
  /** Mirrors the server state machine; screens render it through LiveView. */
  onDecision(decision: RealtimeDecision): void
  onAlert(alert: { kind: 'first' | 'reminder'; collapse: CollapseType | null; at: number }): void
  /** No inference for 5 s → screens show "분석이 잠시 멈췄어요" (status analysisPaused). */
  onStalled(): void
  onClosed(reason: 'ended' | 'network' | 'auth'): void
}

export type RealtimeDecision = {
  status: Extract<LiveStatus, 'normal' | 'suspect' | 'bad' | 'recovering' | 'unmeasurable'>
  collapse: CollapseType | null
  modelVersion: string
  at: number
}

export interface RealtimeConnection {
  send(batch: KeypointFrame[]): void
  close(): void
}

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
