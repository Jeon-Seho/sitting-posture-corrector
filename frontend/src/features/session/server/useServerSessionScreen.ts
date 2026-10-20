import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../../hooks/useCamera'
import type { Machine } from '../../../lib/engine'
import { enableSound, playCorrection } from '../../../lib/sound'
import type { ServerCheckpoint, ServerLiveState, ServerSessionDescriptor } from './contracts'
import { ServerSessionController, type ServerScreenState } from './controller'
import { projectLive } from './projection'
import { SERVER } from '../../platform/serverConfig'
import {
  connectionLost,
  reportConnectionLost,
  subscribeConnectionLost,
} from '../../connection/connectionLost'
import { popupAlert } from '../../desktop/alertPopup'
import { INPUT_PAUSED_NOTICE } from '../../../lib/cameraSample'
import { publishMeasurementStatus, registerMeasurementEnd, type MeasurementStatus } from '../sessionControl'

/** Development switch for the plan 0022 realtime gateway. Unset keeps the HTTP server mode. */
const REALTIME_URL = SERVER.realtimeUrl

export type ServerSessionService = {
  active: boolean
  onCheckpoint: (machine: Machine, checkpoint: ServerCheckpoint) => boolean | void
  onEnded: (live: ServerLiveState) => void
  onArchive?: (live: ServerLiveState) => void
  saveMessage: string
  onRetry: () => void
  /** "2026-10-13 · 세션 2", shown when the connection is lost. */
  sessionLabel?: string
}
type Options = {
  session: ServerSessionDescriptor
  camera: CameraController
  service: ServerSessionService
  alertsOn?: boolean
}

/** React owns display/permission controls; its controller owns ordered server transport. */
export function useServerSessionScreen({ session, camera, service, alertsOn = true }: Options) {
  const [soundOn, setSoundOn] = useState(false)
  const [soundError, setSoundError] = useState('')
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [positionConfirmed, setPositionConfirmed] = useState(!session.server.checkpoint)
  const [archived, setArchived] = useState(false)
  const [state, setState] = useState<ServerScreenState>(() => ({
    phase: session.server.checkpoint ? 'restoring' : 'creating',
    view: session.server.checkpoint?.view ?? null,
    live: projectLive(
      session.server.checkpoint?.view ?? null,
      null,
      session.server.checkpoint?.modelVersion ?? null,
    ),
    message: '',
    queued: 0,
    retryable: false,
    canResume: false,
    connectionLost: false,
  }))
  const controller = useRef<ServerSessionController | null>(null)
  const latest = useRef({ camera, service, soundOn, alertsOn })
  latest.current = { camera, service, soundOn, alertsOn }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const next = new ServerSessionController({
      session,
      realtime: REALTIME_URL ? { url: REALTIME_URL } : undefined,
      onChange: setState,
      onCheckpoint: (machine, checkpoint) =>
        latest.current.service.onCheckpoint(machine, checkpoint),
      onEnded: (live) => latest.current.service.onEnded(live),
      // The session ends here: keep what the server confirmed, then block the app.
      onConnectionLost: () => {
        const { camera: current, service: owner } = latest.current
        current.stop()
        if (owner.onArchive) {
          setArchived(true)
          owner.onArchive(next.state.live)
        }
        reportConnectionLost({ reason: 'network', session: owner.sessionLabel })
      },
      onNotifications: (events) => {
        if (!latest.current.alertsOn) return
        if (latest.current.soundOn && !playCorrection())
          setSoundError('소리를 재생하지 못했습니다. 소리 켜기를 다시 눌러 주세요.')
        const last = events.at(-1)!
        popupAlert(last.kind === 'reminder')
        setToast(
          last.kind === 'reminder'
            ? '흐트러진 자세가 이어져 다시 알려드려요.'
            : '흐트러진 자세가 이어지고 있어요.',
        )
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3000)
      },
    })
    controller.current = next
    const unsubscribe = latest.current.camera.subscribe((frame) =>
      next.ingest(frame, latest.current.camera.deviceId),
    )
    // The settings test (or any other report) ends a running session the same way.
    const unwatch = subscribeConnectionLost(() => {
      if (connectionLost()) next.loseConnection()
    })
    void next.start()
    const timer = setInterval(() => {
      next.tick()
      if (
        next.state.phase === 'running' &&
        (latest.current.camera.state !== 'on' ||
          performance.now() - latest.current.camera.lastFrame.current > 1000)
      ) {
        next.pause(INPUT_PAUSED_NOTICE, false)
      }
    }, 250)
    return () => {
      unsubscribe()
      unwatch()
      clearInterval(timer)
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      next.dispose()
      controller.current = null
    }
  }, [session.id])

  // The small camera window's X ends this measurement from any tab (2026-10-20).
  const over = state.phase === 'ended' || state.phase === 'lost' || state.connectionLost
  useEffect(() => {
    if (over) return
    return registerMeasurementEnd(() => controller.current?.end())
  }, [over])

  // The small camera window shows the posture while another tab is open (2026-10-20).
  const windowStatus: MeasurementStatus | null = over
    ? null
    : state.phase === 'running'
      ? state.live.alerting
        ? 'alert'
        : state.live.state === 'unknown'
          ? 'unknown'
          : 'good'
      : state.phase === 'paused'
        ? 'paused'
        : 'unknown'
  useEffect(() => {
    publishMeasurementStatus(windowStatus)
  }, [windowStatus])
  useEffect(() => () => publishMeasurementStatus(null), [])

  // Measurement keeps running while another tab (e.g. records) is open (user decision 2026-10-06).
  useEffect(() => {
    if (state.phase === 'ended') latest.current.camera.stop()
    if (state.phase !== 'running' || !alertsOn) setToast(null)
  }, [state.phase, alertsOn])

  async function toggleSound() {
    if (soundOn) {
      setSoundOn(false)
      return
    }
    try {
      await enableSound()
      setSoundOn(true)
      setSoundError('')
    } catch {
      setSoundError('이 브라우저에서 소리를 켜지 못했습니다.')
    }
  }

  const matchingCamera =
    camera.state === 'on' &&
    camera.quality &&
    camera.progress === null &&
    camera.deviceId === session.server.deviceId &&
    camera.videoRef.current?.videoWidth === session.server.frameWidth &&
    camera.videoRef.current?.videoHeight === session.server.frameHeight

  return {
    ...state,
    archived,
    rules: session.rules,
    soundOn,
    soundError,
    toggleSound,
    showSkeleton,
    setShowSkeleton,
    toast,
    positionConfirmed,
    setPositionConfirmed,
    canResume: state.canResume && matchingCamera && positionConfirmed,
    pause: () => controller.current?.pause(),
    resume: () => {
      if (matchingCamera && positionConfirmed) controller.current?.resume()
    },
    end: () => controller.current?.end(),
    retry: () => {
      void controller.current?.retry()
    },
    archive: () => {
      if (!service.onArchive || (!state.retryable && state.phase !== 'lost')) return
      controller.current?.dispose()
      camera.stop()
      setArchived(true)
      service.onArchive(state.live)
    },
  }
}

export type ServerSessionScreen = ReturnType<typeof useServerSessionScreen>
