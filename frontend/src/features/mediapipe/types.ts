import type { Landmark } from '../../../../model/prototype/pose'

export type PoseDelegate = 'GPU' | 'CPU'
export type PoseVariant = 'lite' | 'full' | 'heavy'
export type PoseTrackerOptions = { variant?: PoseVariant; delegate?: PoseDelegate | 'auto' }
export type PoseTrackerDiagnostics = Readonly<{
  variant: PoseVariant
  modelId: string
  requestedDelegate: PoseDelegate | 'auto'
  /** Successfully created SDK delegate, not a hardware-utilization measurement. */
  actualDelegate: PoseDelegate
  fallbackReason: string | null
  initializationMs: number
  /** Renderer of the SDK's own texture context; unavailable on restricted browsers. */
  graphics?: Readonly<{ renderer: string; vendor: string; version: string; softwareRenderer: boolean }> | null
}>

/** Unsmoothed inference output. No calibration, classification or UI state. */
export type PoseFrame = {
  /** Actual coordinate extractor identity; absent on legacy or synthetic sources. */
  poseModelId?: string
  timeMs: number
  videoTimeMs: number
  landmarks: Landmark[]
  worldLandmarks: Landmark[]
  /** Original indices 13..22 for the /dev keypoint replay only; service judging never reads them. */
  armLandmarks?: Landmark[]
  armWorldLandmarks?: Landmark[]
  inferenceMs: number
  delegate: PoseDelegate
  width: number
  height: number
}

export type PoseMetrics = { fps: number; inferenceMs: number; delegate: PoseDelegate }

/** SDK types stop at the adapter; callers can substitute a synthetic tracker. */
export interface PoseTracker {
  readonly delegate: PoseDelegate
  readonly diagnostics?: PoseTrackerDiagnostics
  detectFrame(input: HTMLVideoElement | HTMLCanvasElement, timeMs: number, videoTimeMs?: number): PoseFrame
  close(): void
}
