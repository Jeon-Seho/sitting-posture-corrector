import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraController, Observation } from '../../../hooks/useCamera'
import { playCorrection } from '../../../lib/sound'
import { ServerRequestError, type ServerReply, type SessionClient } from './client'
import type { ServerSessionDescriptor } from './contracts'
import { useServerSessionScreen, type ServerSessionService } from './useServerSessionScreen'
import { ServerSessionPage } from './ServerSessionPage'
import {
  BASELINE,
  cameraFrame,
  checkpoint,
  deferred,
  descriptor,
  flush,
  syntheticClient,
  view,
} from './testFixtures'

const controls = vi.hoisted(() => ({ client: null as unknown as SessionClient }))
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  createSessionClient: () => controls.client,
}))
vi.mock('../../../hooks/useSession', () => ({
  useSession: () => {
    throw new Error('Server mode must not mount the local engine')
  },
}))
vi.mock('../../../lib/sound', () => ({
  enableSound: vi.fn(async () => {}),
  playCorrection: vi.fn(() => true),
}))

describe('server screen lifecycle without camera permissions or local time decisions', () => {
  let renderer: ReactTestRenderer | undefined
  let latest: ReturnType<typeof useServerSessionScreen>
  let camera: CameraController
  let service: ServerSessionService
  let listeners: Set<(frame: Observation) => void>
  let client: ReturnType<typeof syntheticClient>['client']
  function Probe({
    session = descriptor(),
    alertsOn = true,
  }: {
    session?: ServerSessionDescriptor
    alertsOn?: boolean
  }) {
    latest = useServerSessionScreen({ session, camera, service, alertsOn })
    return null
  }
  async function mount(session = descriptor()) {
    await act(async () => {
      renderer = create(<Probe session={session} />)
      await flush()
    })
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    listeners = new Set()
    camera = {
      state: 'on',
      quality: true,
      baseline: BASELINE,
      calibrationId: descriptor().server.baselineId,
      progress: null,
      deviceId: 'synthetic-device',
      lastFrame: { current: 0 },
      current: { current: BASELINE },
      videoRef: { current: { videoWidth: 640, videoHeight: 480 } },
      canvasRef: { current: null },
      streamRef: { current: null },
      visual: { mode: 'skeleton', enabled: true, reducedMotion: false, startedAt: 0 },
      setOverlayEnabled: vi.fn(),
      subscribe: (listener: (frame: Observation) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      stop: vi.fn(),
    } as unknown as CameraController
    service = {
      active: true,
      onCheckpoint: vi.fn(() => true),
      onEnded: vi.fn(),
      onArchive: vi.fn(),
      saveMessage: '합성 저장 상태',
      onRetry: vi.fn(),
    }
    client = syntheticClient().client
    controls.client = client
    vi.mocked(playCorrection).mockClear()
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('never mounts the local timer or increases confirmed totals without accepted input', async () => {
    await mount()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(latest.phase).toBe('running')
    expect(latest.live.totalSeconds).toBe(0)
    expect(client.send).toHaveBeenCalledTimes(1)
  })

  it('does not pause merely because the browser tab becomes hidden', async () => {
    await mount()
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true })
      vi.advanceTimersByTime(500)
    })
    expect(latest.phase).toBe('running')
    expect(document.addEventListener).not.toHaveBeenCalledWith(
      'visibilitychange',
      expect.anything(),
    )
    expect(latest.live.validSeconds).toBe(0)
  })

  it('pauses an actual stale camera stream and requires manual resumption', async () => {
    await mount()
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(latest.phase).toBe('paused')
    expect(latest.message).toContain('카메라 입력이 끊겼습니다')
    expect(latest.live.totalSeconds).toBe(0)
    camera.lastFrame.current = Date.now()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(latest.phase).toBe('paused')
  })

  it('aborts an unfinished create on unmount and ignores its late response', async () => {
    const pending = deferred<ServerReply>()
    client.send.mockImplementationOnce(() => pending.promise)
    await mount()
    const signal = client.send.mock.calls[0][1]
    act(() => renderer!.unmount())
    renderer = undefined
    pending.resolve({ view: view() })
    await flush()
    expect(signal.aborted).toBe(true)
    expect(listeners.size).toBe(0)
    expect(service.onEnded).not.toHaveBeenCalled()
    expect(service.onCheckpoint).toHaveBeenCalledTimes(1)
  })

  it('holds the camera and final result until the server acknowledges the fixed end', async () => {
    await mount()
    const pending = deferred<ServerReply>(),
      response = syntheticClient()
    client.send.mockImplementationOnce(() => pending.promise)
    vi.setSystemTime(100)
    act(() => latest.end())
    expect(camera.stop).not.toHaveBeenCalled()
    expect(service.onEnded).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve(response.respond(client.send.mock.calls[1][0]))
      await flush()
    })
    expect(service.onEnded).toHaveBeenCalledOnce()
    expect(camera.stop).toHaveBeenCalledOnce()
    expect(latest.phase).toBe('ended')
  })

  it('restores a fixed baseline without requiring a new calibration and suppresses historical alerts', async () => {
    const source = view({ last_sequence: 0 })
    source.summary = {
      ...source.summary,
      total_ms: 3000,
      valid_ms: 3000,
      deviation_ms: 3000,
      collapse_count: 1,
      alert_count: 1,
      keep_rate: 0,
      events_per_hour: 1200,
    }
    source.events = [
      {
        schema_version: '1.0',
        session_id: source.session_id,
        event_id: 1,
        kind: 'collapse_confirmed',
        timestamp_ms: 3000,
        onset_ms: 0,
        onset_valid_ms: 0,
        deviation_type: 'forward_slouch',
        reason: null,
      },
    ]
    const saved = checkpoint({
      view: source,
      elapsedMs: 3000,
      nextSequence: 1,
      modelVersion: 'reference-feature-rule-v1',
    })
    const session = descriptor()
    session.server.checkpoint = saved
    controls.client = syntheticClient(source).client
    camera.baseline = null
    await mount(session)
    await act(async () => {
      await latest.toggleSound()
      await flush()
    })
    expect(latest.phase).toBe('paused')
    expect(latest.toast).toBeNull()
    expect(playCorrection).not.toHaveBeenCalled()
    expect(latest.canResume).toBe(false)
    act(() => latest.setPositionConfirmed(true))
    expect(latest.canResume).toBe(true)
    act(() => latest.resume())
    expect(latest.phase).toBe('running')
    expect(playCorrection).not.toHaveBeenCalled()
  })

  it('explicitly archives only the last server-confirmed snapshot, stops capture, and never sends end', async () => {
    client.get.mockRejectedValueOnce(new ServerRequestError('Synthetic lost session', 404))
    const session = descriptor()
    session.server.checkpoint = checkpoint()
    await mount(session)
    expect(latest.phase).toBe('lost')
    act(() => latest.archive())
    expect(service.onArchive).toHaveBeenCalledWith(
      expect.objectContaining({ view: view(), totalSeconds: 0 }),
    )
    expect(camera.stop).toHaveBeenCalledOnce()
    expect(client.send).not.toHaveBeenCalled()
    expect(service.onEnded).not.toHaveBeenCalled()
    expect(latest.archived).toBe(true)
    act(() => {
      for (const receive of listeners) receive(cameraFrame(100))
    })
    expect(client.send).not.toHaveBeenCalled()
  })

  it('keeps confirmed server statistics while disabled alerts suppress toast and sound', async () => {
    client.send.mockImplementation(async (request) => {
      if (request.kind === 'create') return { view: view() }
      if (request.kind !== 'features') throw new Error('Synthetic test sends only features')
      const end = request.body.end_ms
      const confirmed = end === 3000
      const server = view({ last_sequence: request.body.sequence })
      server.summary = {
        ...server.summary,
        total_ms: end,
        valid_ms: end,
        deviation_ms: end,
        collapse_count: confirmed ? 1 : 0,
        alert_count: confirmed ? 1 : 0,
        keep_rate: 0,
        events_per_hour: confirmed ? 1200 : 0,
      }
      if (confirmed)
        server.events = [
          {
            schema_version: '1.0',
            session_id: server.session_id,
            event_id: 1,
            kind: 'collapse_confirmed',
            timestamp_ms: 3000,
            onset_ms: 0,
            onset_valid_ms: 0,
            deviation_type: 'forward_slouch',
            reason: null,
          },
        ]
      return {
        view: server,
        observation: {
          schema_version: '2.0',
          sequence: request.body.sequence,
          start_ms: request.body.start_ms,
          end_ms: end,
          phase: 'running',
          valid: true,
          collapse_probability: 0.9,
          deviation_type: 'forward_slouch',
          model_version: 'reference-feature-rule-v1',
        },
      }
    })
    await act(async () => {
      renderer = create(<Probe alertsOn={false} />)
      await flush()
    })
    await act(async () => {
      await latest.toggleSound()
    })
    for (const time of [0, 1000, 2000, 3000]) {
      await act(async () => {
        vi.setSystemTime(time)
        camera.lastFrame.current = time
        for (const receive of listeners) receive(cameraFrame(time))
        await flush()
      })
    }
    expect(latest.view?.summary.collapse_count).toBe(1)
    expect(latest.view?.summary.alert_count).toBe(1)
    expect(latest.live.validSeconds).toBe(3)
    expect(latest.toast).toBeNull()
    expect(playCorrection).not.toHaveBeenCalled()
  })

  it('shows archive save failure beside the unconfirmed server-end notice in the result UI', async () => {
    client.get.mockRejectedValueOnce(new ServerRequestError('Synthetic lost session', 404))
    const session = descriptor()
    session.server.checkpoint = checkpoint()
    function ArchiveProbe() {
      const [saveMessage, setSaveMessage] = useState('합성 저장 대기')
      return (
        <ServerSessionPage
          session={session}
          camera={camera}
          service={{
            ...service,
            saveMessage,
            onArchive: (live) => {
              service.onArchive?.(live)
              setSaveMessage(
                '저장하지 못했습니다. 결과는 유지됩니다. 저장 다시 시도를 눌러 주세요.',
              )
            },
          }}
          onFinish={vi.fn()}
          onDashboard={vi.fn()}
          onPrepare={vi.fn()}
        />
      )
    }
    await act(async () => {
      renderer = create(<ArchiveProbe />)
      await flush()
    })
    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.props.children === '서버 종료 미확인 · 확인된 요약만 보관')!
        .props.onClick(),
    )
    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.props.children === '확인된 요약 보관')!
        .props.onClick(),
    )
    const description = renderer!.root.findByProps({ className: 'page-desc' }).children.join('')
    expect(description).toContain('서버 종료를 확인하지 못했습니다')
    expect(description).toContain('저장하지 못했습니다')
    expect(description).toContain('결과는 유지됩니다')
    expect(service.onArchive).toHaveBeenCalledOnce()
    expect(service.onEnded).not.toHaveBeenCalled()
  })
})
