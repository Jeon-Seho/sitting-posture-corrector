import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../../hooks/useCamera'
import type { Machine } from '../../../lib/engine'
import { COLLAPSE_LABEL } from '../../../data/posture'
import { enableSound, playCorrection } from '../../../lib/sound'
import type { ServerCheckpoint, ServerLiveState, ServerSessionDescriptor } from './contracts'
import { ServerSessionController, type ServerScreenState } from './controller'
import { projectLive } from './projection'

export type ServerSessionService = {
  active: boolean
  onCheckpoint: (machine: Machine, checkpoint: ServerCheckpoint) => boolean | void
  onEnded: (live: ServerLiveState) => void
  onArchive?: (live: ServerLiveState) => void
  saveMessage: string
  onRetry: () => void
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
  }))
  const controller = useRef<ServerSessionController | null>(null)
  const latest = useRef({ camera, service, soundOn, alertsOn })
  latest.current = { camera, service, soundOn, alertsOn }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const next = new ServerSessionController({
      session,
      onChange: setState,
      onCheckpoint: (machine, checkpoint) =>
        latest.current.service.onCheckpoint(machine, checkpoint),
      onEnded: (live) => latest.current.service.onEnded(live),
      onNotifications: (events) => {
        if (!latest.current.alertsOn) return
        if (latest.current.soundOn && !playCorrection())
          setSoundError('소리를 재생하지 못했습니다. 소리 켜기를 다시 눌러 주세요.')
        const last = events.at(-1)!
        const label =
          last.deviation_type === 'forward_slouch'
            ? COLLAPSE_LABEL.forwardHead
            : last.deviation_type === 'left_lean' || last.deviation_type === 'right_lean'
              ? COLLAPSE_LABEL.tilt
              : '기준 자세 변화'
        setToast(
          last.kind === 'reminder'
            ? `${label} 사건의 재알림입니다.`
            : `서버에서 ${label} 사건을 확정했습니다.`,
        )
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3000)
      },
    })
    controller.current = next
    const unsubscribe = latest.current.camera.subscribe((frame) =>
      next.ingest(frame, latest.current.camera.deviceId),
    )
    void next.start()
    const timer = setInterval(() => {
      next.tick()
      if (
        next.state.phase === 'running' &&
        (latest.current.camera.state !== 'on' ||
          performance.now() - latest.current.camera.lastFrame.current > 1000)
      ) {
        next.pause('카메라 입력이 끊겼습니다. 준비를 확인하고 직접 재개해 주세요.', false)
      }
    }, 250)
    return () => {
      unsubscribe()
      clearInterval(timer)
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      next.dispose()
      controller.current = null
    }
  }, [session.id])

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
